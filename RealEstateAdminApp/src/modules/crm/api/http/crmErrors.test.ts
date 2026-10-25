import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';
import { buildRateLimitMessage, CrmApiException, isNotFoundError, isRetryableError, isVersionConflict, normalizeApiError, toApiError } from './crmErrors';

const httpError = (status: number, data: unknown): AxiosError => {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, {}, { status, data, statusText: '', headers: {}, config } as AxiosResponse);
};

describe('normalizeApiError (05 §1.3, §5)', () => {
  it('giữ errorCode + message tiếng Việt + details của server', () => {
    const error = normalizeApiError(httpError(409, { statusCode: 409, message: 'Hồ sơ đã bị sửa', errorCode: 'VERSION_CONFLICT', details: { currentVersion: 7 } }));
    expect(error).toMatchObject({ statusCode: 409, errorCode: 'VERSION_CONFLICT', message: 'Hồ sơ đã bị sửa', details: { currentVersion: 7 } });
    expect(isVersionConflict(error)).toBe(true);
  });

  it('lỗi validate (message là mảng) -> gộp tối đa 3 dòng, mã VALIDATION_FAILED mặc định', () => {
    const error = normalizeApiError(httpError(400, { statusCode: 400, message: ['a', 'b', 'c', 'd'] }));
    expect(error.errorCode).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('a\nb\nc');
  });

  it('429 RATE_LIMITED -> thông báo thân thiện, nêu số giây chờ nếu có', () => {
    const withWait = normalizeApiError(httpError(429, { statusCode: 429, message: 'Too Many Requests', errorCode: 'RATE_LIMITED', details: { retryAfterSeconds: 12 } }));
    expect(withWait.message).toBe('Bạn thao tác quá nhanh. Vui lòng thử lại sau 12 giây.');
    expect(buildRateLimitMessage(undefined)).toContain('thử lại sau ít phút');
    expect(normalizeApiError(httpError(429, {})).errorCode).toBe('RATE_LIMITED');
  });

  it('403/404/503 không có body -> mã và thông báo mặc định; 5xx không lộ message gốc của server', () => {
    expect(normalizeApiError(httpError(403, {})).message).toBe('Bạn không có quyền thực hiện thao tác này.');
    const notFound = normalizeApiError(httpError(404, {}));
    expect(isNotFoundError(notFound)).toBe(true);
    const unavailable = normalizeApiError(httpError(503, { message: 'MongoServerError: connection to 10.0.0.5 refused', errorCode: 'SERVICE_UNAVAILABLE' }));
    expect(unavailable.message).toBe('Hệ thống đang bận hoặc đang bảo trì. Vui lòng thử lại sau ít phút.');
    expect(unavailable.message).not.toContain('Mongo');
    expect(isRetryableError(unavailable)).toBe(true);
    expect(isRetryableError(normalizeApiError(httpError(400, {})))).toBe(false);
    expect(isRetryableError(normalizeApiError(httpError(429, {})))).toBe(false);
  });

  it('không có phản hồi (mất mạng) / quá thời gian', () => {
    const offline = normalizeApiError(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(offline).toMatchObject({ statusCode: 0, errorCode: 'NETWORK_ERROR' });
    expect(isRetryableError(offline)).toBe(true);
    expect(normalizeApiError(new AxiosError('timeout', 'ECONNABORTED')).errorCode).toBe('TIMEOUT');
  });

  it('toApiError giữ nguyên ApiError bọc trong CrmApiException', () => {
    const apiError = { statusCode: 404, errorCode: 'CUSTOMER_NOT_FOUND', message: 'x' };
    expect(toApiError(new CrmApiException(apiError))).toBe(apiError);
    expect(toApiError(new Error('lạ')).errorCode).toBe('UNKNOWN_ERROR');
  });
});
