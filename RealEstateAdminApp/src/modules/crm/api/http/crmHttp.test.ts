import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));

import { cleanParams, crmHttp, IDEMPOTENCY_HEADER, resetIdempotencyKeys, toResult } from './crmHttp';

const failure = (status: number, data: unknown): AxiosError => {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('x', 'ERR_BAD_REQUEST', config, {}, { status, data, statusText: '', headers: {}, config } as AxiosResponse);
};

beforeEach(() => {
  request.mockReset();
  resetIdempotencyKeys();
});

describe('cleanParams (05 §1.4)', () => {
  it('bỏ rỗng/undefined/null/mảng rỗng, nối mảng bằng dấu phẩy, giữ số 0 và false', () => {
    expect(cleanParams({ q: '', page: 1, statusIds: ['a', 'b'], projectIds: [], from: undefined, to: null, isRead: false, progress: [0, 25], offset: 0 })).toEqual({
      page: 1,
      statusIds: 'a,b',
      isRead: false,
      progress: '0,25',
      offset: 0,
    });
    expect(cleanParams({ q: '' })).toBeUndefined();
  });
});

describe('crmHttp: bọc { data } và X-Idempotency-Key', () => {
  it('get trả data của { data }; list trả nguyên { data, meta }', async () => {
    request.mockResolvedValueOnce({ data: { data: { id: '1' } } });
    expect(await crmHttp.get('/crm/customers/1')).toEqual({ id: '1' });
    request.mockResolvedValueOnce({ data: { data: [1], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } } });
    expect((await crmHttp.list('/crm/customers')).meta.total).toBe(1);
  });

  it('route [IK]: gửi X-Idempotency-Key; gửi lại ĐÚNG nội dung (bấm đúp/lỗi mạng) dùng lại khóa; thành công thì khóa mới ở lần sau', async () => {
    request.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));
    await expect(crmHttp.post('/crm/customers', { phone: '1' }, { isIdempotent: true })).rejects.toBeTruthy();
    request.mockResolvedValueOnce({ data: { data: {} } });
    await crmHttp.post('/crm/customers', { phone: '1' }, { isIdempotent: true });
    request.mockResolvedValueOnce({ data: { data: {} } });
    await crmHttp.post('/crm/customers', { phone: '1' }, { isIdempotent: true });
    const keys = request.mock.calls.map(([config]) => config.headers[IDEMPOTENCY_HEADER]);
    expect(keys[0]).toBe(keys[1]); // thử lại sau lỗi mạng: cùng khóa
    expect(keys[2]).not.toBe(keys[1]); // sau thành công: ý định mới
  });

  it('nội dung khác -> khóa khác; lỗi nghiệp vụ 4xx là kết quả cuối nên lần sau dùng khóa mới', async () => {
    request.mockRejectedValueOnce(failure(400, { message: ['sai'] }));
    await expect(crmHttp.post('/crm/customers', { phone: 'x' }, { isIdempotent: true })).rejects.toMatchObject({ apiError: { statusCode: 400 } });
    request.mockResolvedValueOnce({ data: { data: {} } });
    await crmHttp.post('/crm/customers', { phone: 'x' }, { isIdempotent: true });
    request.mockResolvedValueOnce({ data: { data: {} } });
    await crmHttp.post('/crm/customers', { phone: 'y' }, { isIdempotent: true });
    const keys = request.mock.calls.map(([config]) => config.headers[IDEMPOTENCY_HEADER]);
    expect(new Set(keys).size).toBe(3);
  });

  it('409 IDEMPOTENCY_IN_PROGRESS giữ khóa (đang xử lý, không tạo ý định mới)', async () => {
    request.mockRejectedValueOnce(failure(409, { errorCode: 'IDEMPOTENCY_IN_PROGRESS', message: 'đang xử lý' }));
    await expect(crmHttp.post('/crm/appointments', { a: 1 }, { isIdempotent: true })).rejects.toBeTruthy();
    request.mockResolvedValueOnce({ data: { data: {} } });
    await crmHttp.post('/crm/appointments', { a: 1 }, { isIdempotent: true });
    const [first, second] = request.mock.calls.map(([config]) => config.headers[IDEMPOTENCY_HEADER]);
    expect(first).toBe(second);
  });

  it('route không [IK] không gửi header khóa', async () => {
    request.mockResolvedValueOnce({ data: { data: {} } });
    await crmHttp.patch('/crm/customers/1', { version: 1 });
    expect(request.mock.calls[0][0].headers[IDEMPOTENCY_HEADER]).toBeUndefined();
  });
});

describe('toResult', () => {
  it('đổi ngoại lệ thành ApiResult có thông báo tiếng Việt', async () => {
    request.mockRejectedValueOnce(failure(403, { statusCode: 403, message: 'Forbidden' }));
    const result = await toResult(() => crmHttp.get('/crm/settings'));
    expect(result).toMatchObject({ ok: false, error: { statusCode: 403, message: 'Bạn không có quyền thực hiện thao tác này.' } });
    request.mockResolvedValueOnce({ data: { data: 5 } });
    expect(await toResult(() => crmHttp.get('/x'))).toEqual({ ok: true, data: 5 });
  });
});

describe('hashFingerprint (khóa idempotency không giữ nội dung gốc)', () => {
  it('ổn định, khác nhau theo nội dung, không chứa SĐT thô', async () => {
    const { hashFingerprint } = await import('./crmHttp');
    const first = hashFingerprint('post /crm/customers {"phone":"0912345678"}');
    expect(hashFingerprint('post /crm/customers {"phone":"0912345678"}')).toBe(first);
    expect(hashFingerprint('post /crm/customers {"phone":"0912345679"}')).not.toBe(first);
    expect(first).not.toContain('0912345678');
  });
});
