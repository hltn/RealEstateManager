import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../dto/pagination-query.dto';
import { PaginationMetaDto } from '../dto/paginated-response.dto';

/** Cặp giá trị phân trang đã được chuẩn hóa để đưa xuống tầng Service */
export interface NormalizedPagination {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Chuẩn hóa page/limit: DTO đã validate min/max nhưng query có thể vắng mặt,
 * nên vẫn phải fallback về mặc định trước khi tính skip.
 */
export const normalizePagination = (
  page?: number,
  limit?: number,
): NormalizedPagination => {
  const safePage = page ?? DEFAULT_PAGE;
  const safeLimit = limit ?? DEFAULT_LIMIT;
  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
};

/**
 * Tính metadata phân trang. Khi total = 0 thì totalPages = 0 (không để NaN/Infinity
 * do chia cho limit không hợp lệ).
 */
export const buildPaginationMeta = (
  total: number,
  page: number,
  limit: number,
): PaginationMetaDto => ({
  total,
  page,
  limit,
  totalPages: total > 0 && limit > 0 ? Math.ceil(total / limit) : 0,
});
