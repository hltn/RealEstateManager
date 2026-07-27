/**
 * Kiểu dữ liệu chuẩn cho response danh sách có phân trang của Backend.
 * Contract: { data: T[], meta: { total, page, limit, totalPages } }
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Số bản ghi mặc định trên mỗi trang. */
export const DEFAULT_PAGE_SIZE = 20;

/** Các lựa chọn số bản ghi / trang cho UI phân trang. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
