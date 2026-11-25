/**
 * UNIT — NoSqlOperatorInterceptor (FR-14, PT-037): chặn khóa `$`, `__proto__`, `constructor`,
 * khóa chứa `.` và `a[$...]` (query/params), độ sâu > 10, bỏ qua multipart; kèm test hiệu năng.
 */
import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ErrorCode } from '../exceptions/error-codes';
import {
  containsForbiddenKey,
  NoSqlOperatorInterceptor,
  NOSQL_MAX_DEPTH,
  NOSQL_REJECT_MESSAGE,
} from './nosql-operator.interceptor';

interface FakeRequest {
  body?: unknown;
  query?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
}

function makeContext(request: FakeRequest, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of('ok') };

function nest(depth: number, leaf: unknown = 1): Record<string, unknown> {
  let node: unknown = leaf;
  for (let i = 0; i < depth; i += 1) node = { a: node };
  return node as Record<string, unknown>;
}

describe('NoSqlOperatorInterceptor (FR-14)', () => {
  const interceptor = new NoSqlOperatorInterceptor();
  const run = (request: FakeRequest, type?: string) =>
    lastValueFrom(
      interceptor.intercept(makeContext(request, type), next) as never,
    );

  async function expectRejected(request: FakeRequest) {
    let error: unknown;
    try {
      await run(request);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException & { errorCode?: string };
    expect(http.getStatus()).toBe(400);
    expect(http.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    expect(http.message).toBe(NOSQL_REJECT_MESSAGE);
  }

  it('FR-14: cho qua request hợp lệ (body/query/params thường)', async () => {
    await expect(
      run({
        body: { name: 'A', tags: ['x', 'y'], nested: { k: 1 } },
        query: { q: 'abc', 'statusIds[0]': 'x', page: '1' },
        params: { id: '507f1f77bcf86cd799439011' },
      }),
    ).resolves.toBe('ok');
  });

  it('FR-14: cho qua request không có body/query/params', async () => {
    await expect(run({})).resolves.toBe('ok');
  });

  it('FR-14: bỏ qua ngữ cảnh không phải http', async () => {
    await expect(run({ body: { $ne: 1 } }, 'rpc')).resolves.toBe('ok');
  });

  it('FR-14: từ chối khóa `$` ở gốc body', async () => {
    await expectRejected({ body: { $where: 'x' } });
  });

  it('FR-14: từ chối khóa `$` lồng sâu trong body', async () => {
    await expectRejected({ body: { a: { b: { c: { $ne: null } } } } });
  });

  it('FR-14: từ chối khóa `$` nằm trong phần tử của mảng', async () => {
    await expectRejected({ body: { items: [{ ok: 1 }, [{ $gt: 1 }]] } });
  });

  it('FR-14: từ chối `__proto__` và `constructor` ở body', async () => {
    const proto = JSON.parse('{"x":{"__proto__":{"admin":true}}}') as unknown;
    await expectRejected({ body: proto });
    await expectRejected({ body: { constructor: { prototype: {} } } });
  });

  it('FR-14: từ chối khóa `$` ở query và params', async () => {
    await expectRejected({ query: { phone: { $ne: '' } } });
    await expectRejected({ params: { $or: 'x' } });
  });

  it('FR-14: query dạng `a[$ne]` (Fastify không parse lồng) bị chặn', async () => {
    await expectRejected({ query: { 'actions[$ne]': 'x' } });
    await expectRejected({ query: { 'a[ $regex]': '.*' } });
    await expectRejected({ query: { 'a[__proto__]': '1' } });
  });

  it('FR-14: query/params chứa khóa có dấu `.` bị chặn', async () => {
    await expectRejected({ query: { 'owner.role': 'ADMIN' } });
    await expectRejected({ params: { 'a.b': '1' } });
  });

  it('FR-14: body KHÔNG bị chặn vì khóa có dấu `.` (không vỡ crawlConfig)', async () => {
    await expect(
      run({ body: { crawlConfig: { 'a.b': 1, 'x[y]': 2 } } }),
    ).resolves.toBe('ok');
  });

  it('FR-14: query dạng `a[b]` / `ids[0]` hợp lệ vẫn qua', async () => {
    await expect(
      run({ query: { 'filter[status]': 'NEW', 'ids[0]': 'a' } }),
    ).resolves.toBe('ok');
  });

  it('FR-14: đúng độ sâu tối đa thì qua, vượt 1 cấp thì bị từ chối', async () => {
    await expect(run({ body: nest(NOSQL_MAX_DEPTH) })).resolves.toBe('ok');
    await expectRejected({ body: nest(NOSQL_MAX_DEPTH + 1) });
  });

  it('FR-14: mảng lồng sâu quá độ sâu bị từ chối', async () => {
    let node: unknown = [1];
    for (let i = 0; i < NOSQL_MAX_DEPTH + 1; i += 1) node = [node];
    await expectRejected({ body: node });
  });

  it('FR-14: multipart bỏ qua body nhưng vẫn kiểm query/params', async () => {
    const headers = { 'content-type': 'multipart/form-data; boundary=xyz' };
    await expect(
      run({ headers, body: { $ne: 1 }, query: {}, params: { id: 'a' } }),
    ).resolves.toBe('ok');
    await expectRejected({ headers, body: {}, query: { 'a[$ne]': '1' } });
  });

  describe('hiệu năng (FR-14, không DoS)', () => {
    it('FR-14: object rộng 100k khóa duyệt trong thời gian ngắn', () => {
      const wide: Record<string, number> = {};
      for (let i = 0; i < 100_000; i += 1) wide[`k${i}`] = i;
      const start = Date.now();
      expect(containsForbiddenKey(wide, false)).toBe(false);
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it('FR-14: object cực sâu (100k cấp) bị từ chối nhanh, không tràn stack', () => {
      const start = Date.now();
      expect(containsForbiddenKey(nest(100_000), false)).toBe(true);
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it('FR-14: mảng 100k phần tử object duyệt nhanh', () => {
      const arr = Array.from({ length: 100_000 }, (_, i) => ({ i }));
      const start = Date.now();
      expect(containsForbiddenKey({ arr }, false)).toBe(false);
      expect(Date.now() - start).toBeLessThan(1000);
    });
  });
});
