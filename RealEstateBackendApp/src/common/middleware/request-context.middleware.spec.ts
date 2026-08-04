/**
 * RequestContextMiddleware unit spec — contract mục 4 (Correlation ID / X-Request-ID).
 *
 * Bao phủ:
 * - FE gửi header `x-request-id` → dùng lại chính ID đó (trace xuyên service).
 * - FE không gửi → middleware tự sinh UUID (crypto.randomUUID).
 * - Set header `x-request-id` vào response để caller trace ngược.
 * - Lưu requestId vào AsyncLocalStorage để service trong cùng async chain đọc được.
 */
import { RequestContextMiddleware } from './request-context.middleware';
import { requestContextStorage } from '../services/request-context.service';
import type { IncomingMessage, ServerResponse } from 'http';

function mockReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function mockRes(): {
  res: ServerResponse;
  setHeaderSpy: jest.Mock;
} {
  const setHeaderSpy = jest.fn();
  const res = { setHeader: setHeaderSpy } as unknown as ServerResponse;
  return { res, setHeaderSpy };
}

describe('RequestContextMiddleware (contract mục 4 — Correlation ID)', () => {
  let middleware: RequestContextMiddleware;

  beforeEach(() => {
    middleware = new RequestContextMiddleware();
  });

  it('FE gửi header x-request-id → dùng lại ID đó (không sinh mới)', () => {
    const req = mockReq({ 'x-request-id': 'req-abc-123' });
    const { res, setHeaderSpy } = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(setHeaderSpy).toHaveBeenCalledWith('x-request-id', 'req-abc-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('FE không gửi x-request-id → tự sinh UUID (string, độ dài 36 dạng v4)', () => {
    const req = mockReq({});
    const { res, setHeaderSpy } = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    const id = setHeaderSpy.mock.calls[0][1] as string;
    expect(typeof id).toBe('string');
    // UUID v4 chuẩn: 8-4-4-4-12 hex.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('header không phân biệt hoa thường — Node.js HTTP luôn lowercase header', () => {
    // Caller gửi "X-Request-ID" nhưng Node.js đã normalize → key lowercase.
    const req = mockReq({ 'x-request-id': 'MixedCase-Works' });
    const { res, setHeaderSpy } = mockRes();
    middleware.use(req, res, jest.fn());

    expect(setHeaderSpy).toHaveBeenCalledWith(
      'x-request-id',
      'MixedCase-Works',
    );
  });

  it('ALS context được set với đúng requestId → next() chạy trong context đó', () => {
    const req = mockReq({ 'x-request-id': 'als-id' });
    const { res } = mockRes();
    let capturedId: string | undefined;

    middleware.use(req, res, () => {
      // Bên trong next(), ALS phải có store với requestId khớp.
      capturedId = requestContextStorage.getStore()?.requestId;
    });

    expect(capturedId).toBe('als-id');
  });

  it('middleware không set ALS context ngoài next() — tránh leak context', () => {
    const req = mockReq({ 'x-request-id': 'leak-test' });
    const { res } = mockRes();

    // Trước khi next() chạy, ALS context chưa được tạo.
    expect(requestContextStorage.getStore()?.requestId).toBeUndefined();

    middleware.use(req, res, () => {
      // Bên trong next() thì có context.
      expect(requestContextStorage.getStore()?.requestId).toBe('leak-test');
    });

    // Sau khi next() thoát ra, ALS quay về trạng thái ngoài context HTTP.
    expect(requestContextStorage.getStore()?.requestId).toBeUndefined();
  });

  it('hai request song song (giả lập) → ID độc lập, không ghi đè chéo', () => {
    const req1 = mockReq({ 'x-request-id': 'req-1' });
    const req2 = mockReq({ 'x-request-id': 'req-2' });
    const { res: res1 } = mockRes();
    const { res: res2 } = mockRes();
    const ids: string[] = [];

    middleware.use(req1, res1, () => {
      ids.push(requestContextStorage.getStore()?.requestId ?? '');
    });
    middleware.use(req2, res2, () => {
      ids.push(requestContextStorage.getStore()?.requestId ?? '');
    });

    expect(ids).toEqual(['req-1', 'req-2']);
  });
});
