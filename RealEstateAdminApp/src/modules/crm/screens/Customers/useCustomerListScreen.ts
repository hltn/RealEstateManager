/**
 * State + dữ liệu dùng chung của màn danh sách khách (desktop + mobile):
 * bộ lọc (store, dùng chung web/app + modal bộ lọc nâng cao) -> query `GET /crm/customers` -> trang dữ liệu + số đếm tab.
 * Đổi bộ lọc/sắp xếp luôn quay về trang 1.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCustomerList, useListCounts, type CustomerListQuery, type CustomerSort } from '@crm/api';
import { clampPage } from '@crm/lib/customerDeletion';
import { useCrmActions, useCrmState } from '@crm/store';
import type { CustomerFilters } from '@crm/types/app';

const FIRST_PAGE = 1;

export const useCustomerListScreen = (initialPageSize: number) => {
  const { filters } = useCrmState();
  const { setFilters } = useCrmActions();
  const [sort, setSortState] = useState<CustomerSort>('-lastUpdatedAt');
  const [page, setPage] = useState(FIRST_PAGE);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const query = useMemo<CustomerListQuery>(() => ({ ...filters, sort, page, limit: pageSize }), [filters, sort, page, pageSize]);
  const countsQuery = useMemo<CustomerListQuery>(() => ({ ...filters, listGroup: 'ALL' }), [filters]);
  const { data: list, isLoading, isFetching, error, refetch } = useCustomerList(query);
  const { data: counts } = useListCounts(countsQuery);

  // Danh sách ngắn lại (vd xóa hết khách của trang cuối) thì lùi về trang cuối còn dữ liệu, không đứng ở trang rỗng.
  const { totalPages } = list.meta;
  useEffect(() => {
    // Lỗi tải (không có dữ liệu thật, totalPages=0) thì GIỮ trang để còn màn lỗi + Thử lại, không đẩy về trang 1.
    if (!isFetching && !error && page > FIRST_PAGE && page !== clampPage(page, totalPages)) setPage(clampPage(page, totalPages));
  }, [isFetching, error, page, totalPages]);

  return {
    filters,
    query,
    list,
    counts,
    isLoading,
    error,
    refetch,
    sort,
    updateFilters: (changes: Partial<CustomerFilters>) => {
      setFilters(changes);
      setPage(FIRST_PAGE);
    },
    setSort: (nextSort: CustomerSort) => {
      setSortState(nextSort);
      setPage(FIRST_PAGE);
    },
    setPage,
    setPageSize: (nextSize: number) => {
      setPageSizeState(nextSize);
      setPage(FIRST_PAGE);
    },
  };
};

export type CustomerListScreen = ReturnType<typeof useCustomerListScreen>;
