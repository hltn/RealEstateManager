/**
 * pagination.util unit spec — contract mục 2 (Response Format phân trang chuẩn).
 *
 * Bao phủ:
 * - normalizePagination fallback DEFAULT_PAGE/DEFAULT_LIMIT khi vắng mặt.
 * - skip = (page - 1) * limit.
 * - buildPaginationMeta: totalPages = Math.ceil(total/limit) khi total > 0.
 * - buildPaginationMeta: totalPages = 0 khi total = 0 (không NaN/Infinity).
 * - buildPaginationMeta: totalPages = 0 khi limit = 0 (defensive).
 */
import {
  normalizePagination,
  buildPaginationMeta,
} from './pagination.util';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../dto/pagination-query.dto';

describe('pagination.util (contract mục 2 — Response Format)', () => {
  describe('normalizePagination', () => {
    it('fallback DEFAULT_PAGE/DEFAULT_LIMIT khi vắng missing', () => {
      const r = normalizePagination();
      expect(r).toEqual({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        skip: 0,
      });
    });

    it('fallback khi truyền undefined', () => {
      expect(normalizePagination(undefined, undefined)).toEqual({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        skip: 0,
      });
    });

    it('skip = (page - 1) * limit', () => {
      expect(normalizePagination(1, 20)).toEqual({ page: 1, limit: 20, skip: 0 });
      expect(normalizePagination(2, 20)).toEqual({ page: 2, limit: 20, skip: 20 });
      expect(normalizePagination(3, 10)).toEqual({ page: 3, limit: 10, skip: 20 });
      expect(normalizePagination(10, 25)).toEqual({ page: 10, limit: 25, skip: 225 });
    });

    it('truyền page nhưng thiếu limit → limit = DEFAULT', () => {
      expect(normalizePagination(5, undefined)).toEqual({
        page: 5,
        limit: DEFAULT_LIMIT,
        skip: 4 * DEFAULT_LIMIT,
      });
    });

    it('truyền limit nhưng thiếu page → page = DEFAULT', () => {
      expect(normalizePagination(undefined, 50)).toEqual({
        page: DEFAULT_PAGE,
        limit: 50,
        skip: 0,
      });
    });

    it('KHÔNG tự clamp min/max (DTO validator đảm nhiệm) — chỉ fallback', () => {
      // normalizePagination không ép lại min/max; caller phải qua DTO trước.
      const r = normalizePagination(-1, 0);
      expect(r.page).toBe(-1);
      expect(r.limit).toBe(0);
      expect(r.skip).toBe(-2 * 0);
    });
  });

  describe('buildPaginationMeta', () => {
    it('totalPages = ceil(total/limit) khi có dữ liệu', () => {
      expect(buildPaginationMeta(100, 1, 20)).toEqual({
        total: 100,
        page: 1,
        limit: 20,
        totalPages: 5,
      });
      expect(buildPaginationMeta(137, 7, 20).totalPages).toBe(7);
      expect(buildPaginationMeta(1, 1, 20).totalPages).toBe(1);
    });

    it('total = 0 → totalPages = 0 (không NaN)', () => {
      const m = buildPaginationMeta(0, 1, 20);
      expect(m.totalPages).toBe(0);
      expect(m).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('total không chia hết → ceil lên (vd 21/20 = 2 trang)', () => {
      expect(buildPaginationMeta(21, 1, 20).totalPages).toBe(2);
      expect(buildPaginationMeta(41, 1, 20).totalPages).toBe(3);
    });

    it('limit = 0 → totalPages = 0 (defensive, không Infinity)', () => {
      const m = buildPaginationMeta(100, 1, 0);
      expect(m.totalPages).toBe(0);
      expect(Number.isFinite(m.totalPages)).toBe(true);
    });

    it('trả đúng shape PaginationMetaDto (4 field)', () => {
      const m = buildPaginationMeta(50, 3, 25);
      expect(Object.keys(m).sort()).toEqual(
        ['limit', 'page', 'total', 'totalPages'].sort(),
      );
    });
  });
});
