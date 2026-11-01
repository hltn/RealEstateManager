import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let meta = { total: 0, page: 1, limit: 10, totalPages: 0 };
let isFetching = false;
let loadError: { message: string } | null = null;
const useCustomerList = vi.fn();

vi.mock('@crm/api', () => ({
  useCustomerList: (query: unknown) => useCustomerList(query),
  useListCounts: () => ({ data: { ALL: 0 } }),
}));
vi.mock('@crm/store', () => ({ useCrmState: () => ({ filters: { listGroup: 'DROPPED' } }), useCrmActions: () => ({ setFilters: vi.fn() }) }));

import { useCustomerListScreen } from './useCustomerListScreen';

beforeEach(() => {
  isFetching = false;
  loadError = null;
  meta = { total: 21, page: 1, limit: 10, totalPages: 3 };
  useCustomerList.mockReset().mockImplementation(() => ({ data: { data: [], meta }, isLoading: false, isFetching, error: loadError, refetch: vi.fn() }));
});

describe('useCustomerListScreen - kẹp trang khi danh sách ngắn lại', () => {
  it('đứng ở trang cuối mà khách bị xóa hết (totalPages giảm) thì lùi về trang cuối còn dữ liệu; hết khách thì về trang 1', () => {
    const { result, rerender } = renderHook(() => useCustomerListScreen(10));
    act(() => result.current.setPage(3));
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));

    meta = { total: 20, page: 3, limit: 10, totalPages: 2 };
    rerender();
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    act(() => result.current.setPage(2));
    meta = { total: 0, page: 1, limit: 10, totalPages: 0 };
    rerender();
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('lỗi tải trang N>1 (không có dữ liệu, totalPages=0) thì GIỮ nguyên trang để còn màn lỗi + Thử lại', () => {
    const { result, rerender } = renderHook(() => useCustomerListScreen(10));
    act(() => result.current.setPage(3));
    loadError = { message: 'Lỗi mạng' };
    meta = { total: 0, page: 1, limit: 20, totalPages: 0 };
    rerender();
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  });

  it('đang tải lại (meta cũ) thì chưa kẹp trang để khỏi nhảy nhầm', () => {
    const { result, rerender } = renderHook(() => useCustomerListScreen(10));
    act(() => result.current.setPage(3));
    isFetching = true;
    meta = { total: 10, page: 1, limit: 10, totalPages: 1 };
    rerender();
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  });
});
