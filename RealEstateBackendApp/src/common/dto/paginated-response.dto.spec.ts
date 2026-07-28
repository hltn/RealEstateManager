/**
 * paginated-response.dto unit spec — contract mục 2 (shape response chuẩn:
 * { data, meta: { total, page, limit, totalPages } }).
 */
import {
  PaginatedResponseDto,
  PaginationMetaDto,
  PaginatedResult,
} from './paginated-response.dto';

describe('paginated-response.dto (contract mục 2)', () => {
  describe('PaginationMetaDto', () => {
    it('instance với 4 field total/page/limit/totalPages', () => {
      const m: PaginationMetaDto = {
        total: 137,
        page: 1,
        limit: 20,
        totalPages: 7,
      };
      expect(Object.keys(m).sort()).toEqual(
        ['limit', 'page', 'total', 'totalPages'].sort(),
      );
    });
  });

  describe('PaginatedResponseDto', () => {
    it('build shape chuẩn { data, meta } cho list string', () => {
      const resp: PaginatedResponseDto<string> = {
        data: ['a', 'b', 'c'],
        meta: { total: 3, page: 1, limit: 20, totalPages: 1 },
      };

      expect(resp.data).toEqual(['a', 'b', 'c']);
      expect(resp.meta).toEqual({
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('generic — hoạt động với object element', () => {
      type Item = { id: number; name: string };
      const resp: PaginatedResponseDto<Item> = {
        data: [{ id: 1, name: 'n1' }],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };
      expect(resp.data[0].id).toBe(1);
    });

    it('page rỗng — data [] + meta { total: 0, totalPages: 0 }', () => {
      const resp: PaginatedResponseDto<unknown> = {
        data: [],
        meta: { total: 0, page: 5, limit: 20, totalPages: 0 },
      };
      expect(resp.data).toHaveLength(0);
      expect(resp.meta.totalPages).toBe(0);
    });
  });

  describe('PaginatedResult<T> (interface tầng Service)', () => {
    it('shape { data, total } — chỉ gồm danh sách trang + total', () => {
      const r: PaginatedResult<number> = { data: [1, 2, 3], total: 100 };
      expect(r.data).toHaveLength(3);
      expect(r.total).toBe(100);
      // Không có meta/skip/limit — meta sẽ do controller/serializer tính.
      expect((r as any).meta).toBeUndefined();
    });
  });
});
