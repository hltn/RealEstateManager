/**
 * State + dữ liệu dùng chung của màn danh sách khách (desktop + mobile):
 * bộ lọc (store, dùng chung web/app + modal bộ lọc nâng cao) -> query `GET /crm/customers` -> trang dữ liệu + số đếm tab.
 * Đổi bộ lọc/sắp xếp luôn quay về trang 1.
 */
import { useMemo, useState } from 'react';
import { useCustomerList, useListCounts, type CustomerListQuery, type CustomerSort } from '@crm/api';
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
  const { data: list } = useCustomerList(query);
  const { data: counts } = useListCounts(countsQuery);

  return {
    filters,
    query,
    list,
    counts,
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
