import axios, { type AxiosError } from 'axios';
import apiAxios from '../api/axios';
import type { PaginatedResponse, PaginationMeta } from '../types/pagination';

/** Chuẩn JSON lỗi của Backend: { statusCode, message, timestamp, path } */
interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  timestamp?: string;
  path?: string;
}

/** Lấy message dễ đọc từ body lỗi của Backend (message có thể là mảng khi validate DTO). */
const extractErrorMessage = (body: ApiErrorBody | null | undefined, fallback: string): string => {
  if (!body?.message) return fallback;
  return Array.isArray(body.message) ? body.message.join(', ') : body.message;
};

/**
 * Lấy message dễ đọc từ lỗi Axios do Backend trả về (status 4xx/5xx).
 * Dùng chung cho các screen/service sau khi migrate sang axios instance.
 */
export const getApiErrorMessage = (err: unknown, fallback: string): string => {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<ApiErrorBody>;
    return extractErrorMessage(axiosErr.response?.data, fallback);
  }
  return err instanceof Error ? err.message : fallback;
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
 * Gọi API danh sách có phân trang qua axios instance (tự đính token + refresh 401).
 * Trả về đúng shape { data, meta }. Ném Error với message từ Backend khi lỗi.
 * URL truyền vào là path tương đối (KHÔNG chứa prefix `/api/v1` — axios baseURL đã có).
 */
export async function fetchPaginated<T>(
  url: string,
  requestedPage: number,
  requestedLimit: number,
  signal?: AbortSignal,
): Promise<PaginatedResponse<T>> {
  try {
    const response = await apiAxios.get<Partial<PaginatedResponse<T>> & ApiErrorBody>(url, {
      signal,
    });
    const body = response.data;

    const items = Array.isArray(body?.data) ? (body.data as T[]) : [];
    return {
      data: items,
      meta: normalizeMeta(body?.meta, items.length, requestedPage, requestedLimit),
    };
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Lỗi khi tải dữ liệu từ máy chủ'));
  }
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
