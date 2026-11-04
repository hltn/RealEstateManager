/**
 * Client HTTP của module CRM — bọc `apiAxios` dùng chung (Bearer token + refresh 401 + `X-Request-ID` đã có ở interceptor).
 * - Mọi hàm ném `CrmApiException` (mang `ApiError` đã chuẩn hóa) để React Query/UI xử lý một kiểu.
 * - `X-Idempotency-Key` cho các route [IK] (05 §1.1): một khóa cho MỖI nội dung gửi; gửi lại đúng nội dung (bấm đúp, thử lại sau
 *   lỗi mạng) dùng lại khóa cũ nên server không tạo trùng; thành công thì bỏ khóa. Nội dung đổi thì khóa mới.
 */
import type { AxiosRequestConfig } from 'axios';
import apiAxios from '../../../../api/axios';
import type { ApiResult, Paginated } from '../types';
import { CrmApiException, normalizeApiError, toApiError } from './crmErrors';

export const IDEMPOTENCY_HEADER = 'X-Idempotency-Key';

/** Query string: bỏ undefined/null/''/mảng rỗng; mảng nối bằng dấu phẩy (05 §1.4). */
export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export const cleanParams = (params?: QueryParams): Record<string, string | number | boolean> | undefined => {
  if (!params) return undefined;
  const entries: [string, string | number | boolean][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) entries.push([key, value.join(',')]);
      continue;
    }
    entries.push([key, value as string | number | boolean]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const createUuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

/** Khóa idempotency đang "treo" theo DẤU VÂN nội dung gửi (băm — không giữ nguyên body/PII trong bộ nhớ): hash -> key. */
const pendingKeys = new Map<string, string>();
const MAX_PENDING_KEYS = 200;

/** Băm FNV-1a 64 bit (hai nửa 32 bit) -> chuỗi hex; đủ để phân biệt nội dung gửi, không cần mật mã. */
export const hashFingerprint = (value: string): string => {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ code ^ (high & 0xff), 0x85ebca6b) >>> 0;
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}${value.length.toString(16)}`;
};

export const getIdempotencyKey = (fingerprint: string): string => {
  const existing = pendingKeys.get(fingerprint);
  if (existing) return existing;
  const key = createUuid();
  if (pendingKeys.size >= MAX_PENDING_KEYS) pendingKeys.delete(pendingKeys.keys().next().value as string);
  pendingKeys.set(fingerprint, key);
  return key;
};

export const releaseIdempotencyKey = (fingerprint: string): void => {
  pendingKeys.delete(fingerprint);
};

/** Chỉ dùng cho test. */
export const resetIdempotencyKeys = (): void => pendingKeys.clear();

interface RequestOptions {
  params?: QueryParams;
  signal?: AbortSignal;
  /** Gắn `X-Idempotency-Key` (route [IK]). */
  isIdempotent?: boolean;
  headers?: Record<string, string>;
}

const request = async <T>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body: unknown, options: RequestOptions = {}): Promise<T> => {
  const config: AxiosRequestConfig = { method, url, data: body, params: cleanParams(options.params), signal: options.signal, headers: { ...options.headers } };
  const fingerprint = options.isIdempotent ? hashFingerprint(`${method} ${url} ${JSON.stringify(body ?? null)}`) : null;
  if (fingerprint) (config.headers as Record<string, string>)[IDEMPOTENCY_HEADER] = getIdempotencyKey(fingerprint);
  try {
    const response = await apiAxios.request<T>(config);
    if (fingerprint) releaseIdempotencyKey(fingerprint);
    return response.data;
  } catch (error) {
    const apiError = normalizeApiError(error);
    // Lỗi nghiệp vụ (4xx trừ 409 đang xử lý/429) là kết quả cuối: lần gửi sau là một ý định mới.
    if (fingerprint && apiError.statusCode >= 400 && apiError.statusCode < 500 && apiError.errorCode !== 'IDEMPOTENCY_IN_PROGRESS' && apiError.statusCode !== 429) {
      releaseIdempotencyKey(fingerprint);
    }
    throw new CrmApiException(apiError);
  }
};

/** Phản hồi `{ data: T }` của API CRM. */
interface Envelope<T> {
  data: T;
}

export const crmHttp = {
  /** `GET` đối tượng: trả `data` của `{ data }`. */
  get: async <T>(url: string, options?: RequestOptions): Promise<T> => (await request<Envelope<T>>('get', url, undefined, options)).data,
  /** `GET` danh sách: trả nguyên `{ data, meta }`. */
  list: <T>(url: string, options?: RequestOptions): Promise<Paginated<T>> => request<Paginated<T>>('get', url, undefined, options),
  post: async <T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> => (await request<Envelope<T>>('post', url, body, options)).data,
  put: async <T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> => (await request<Envelope<T>>('put', url, body, options)).data,
  patch: async <T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> => (await request<Envelope<T>>('patch', url, body, options)).data,
  /** `DELETE` trả 204 (không nội dung). */
  del: async (url: string, options?: RequestOptions): Promise<void> => {
    await request<unknown>('delete', url, undefined, options);
  },
  /** Gọi trả thẳng body (không bọc `{ data }`) — `/users`, `/auth/*`. */
  raw: <T>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown, options?: RequestOptions): Promise<T> => request<T>(method, url, body, options),
};

/** Chạy hàm gọi API và đổi kết quả/ngoại lệ thành `ApiResult` (cho các hàm ghi mà UI xử lý `ok`/`error` tại chỗ). */
export const toResult = async <T>(run: () => Promise<T>): Promise<ApiResult<T>> => {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, error: toApiError(error) };
  }
};
