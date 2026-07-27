import type { PaginatedResponse, PaginationMeta } from '../types/pagination';

/** Chuẩn JSON lỗi của Backend: { statusCode, message, timestamp, path } */
interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  timestamp?: string;
  path?: string;
}

/** Lấy message dễ đọc từ body lỗi của Backend (message có thể là mảng khi validate DTO). */
const extractErrorMessage = (body: ApiErrorBody | null, fallback: string): string => {
  if (!body?.message) return fallback;
  return Array.isArray(body.message) ? body.message.join(', ') : body.message;
};

/**
 * Xây dựng meta an toàn: nếu Backend chưa trả meta (hoặc trả thiếu field),
 * suy ra từ độ dài data để UI không bị lỗi chia cho 0 / undefined.
 */
const normalizeMeta = (
  rawMeta: Partial<PaginationMeta> | undefined,
  itemCount: number,
  requestedPage: number,
  requestedLimit: number,
): PaginationMeta => {
  const limit = rawMeta?.limit && rawMeta.limit > 0 ? rawMeta.limit : requestedLimit;
  const total = typeof rawMeta?.total === 'number' ? rawMeta.total : itemCount;
  const page = rawMeta?.page && rawMeta.page > 0 ? rawMeta.page : requestedPage;
  const totalPages =
    typeof rawMeta?.totalPages === 'number'
      ? rawMeta.totalPages
      : limit > 0
        ? Math.ceil(total / limit)
        : 0;

  return { total, page, limit, totalPages };
};

/**
 * Gọi API danh sách có phân trang và trả về đúng shape { data, meta }.
 * Ném Error với message từ Backend khi response không OK.
 */
export async function fetchPaginated<T>(
  url: string,
  requestedPage: number,
  requestedLimit: number,
  signal?: AbortSignal,
): Promise<PaginatedResponse<T>> {
  const response = await fetch(url, { signal });
  const body = (await response.json().catch(() => null)) as
    | (Partial<PaginatedResponse<T>> & ApiErrorBody)
    | null;

  if (!response.ok) {
    throw new Error(extractErrorMessage(body, 'Lỗi khi tải dữ liệu từ máy chủ'));
  }

  const items = Array.isArray(body?.data) ? (body.data as T[]) : [];
  return {
    data: items,
    meta: normalizeMeta(body?.meta, items.length, requestedPage, requestedLimit),
  };
}

/** Ghép query string cho API danh sách, bỏ qua các param rỗng. */
export const buildListQuery = (params: Record<string, string | number | undefined>): string => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    searchParams.append(key, String(value));
  });
  return searchParams.toString();
};
