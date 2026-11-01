import type { PaginatedResponse } from '../types/pagination';
import type { MockResponse } from './types';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/** Đọc số nguyên dương từ query, sai định dạng thì dùng giá trị mặc định. */
export const readPositiveInt = (query: URLSearchParams, key: string, fallback: number): number => {
  const value = Number(query.get(key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/**
 * Cắt trang cho danh sách mẫu theo `?page=&limit=`, trả đúng contract `{ data, meta }`
 * mà `utils/fetchPaginated.ts` mong đợi.
 */
export const paginate = <T>(items: T[], query: URLSearchParams): PaginatedResponse<T> => {
  const page = readPositiveInt(query, 'page', DEFAULT_PAGE);
  const limit = readPositiveInt(query, 'limit', DEFAULT_LIMIT);
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    meta: { total: items.length, page, limit, totalPages: Math.max(1, Math.ceil(items.length / limit)) },
  };
};

/** Lọc theo từ khoá `?search=` (hoặc key khác) trên các field chuỗi chỉ định. */
export const filterBySearch = <T>(items: T[], keyword: string | null, fields: (keyof T)[]): T[] => {
  const normalized = keyword?.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    fields.some((field) => String(item[field] ?? '').toLowerCase().includes(normalized)),
  );
};

/** Trả 200 với body cho sẵn. */
export const ok = (data: unknown): MockResponse => ({ data, status: 200 });

/** Trả lỗi theo chuẩn JSON lỗi của Backend `{ statusCode, message, timestamp, path }`. */
export const fail = (status: number, message: string, path = ''): MockResponse => ({
  status,
  data: { statusCode: status, message, timestamp: new Date().toISOString(), path },
});

/** Sinh id giả dạng ObjectId (24 ký tự hex). */
export const mockObjectId = (): string =>
  Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** ISO time cách hiện tại `minutesAgo` phút (dữ liệu mẫu trông "mới"). */
export const isoMinutesAgo = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();
