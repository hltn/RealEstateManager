// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/CustomerListView.tsx
// Khung mobile là của Admin (AppHeader + drawer, vùng nội dung đã có `p-4`) + CrmBottomNav của CrmLayout:
// màn KHÔNG vẽ top app bar, không thêm padding ngang, không dùng CrmModuleTabs (thanh đáy đã có 4 tab).
// Bố cục Stitch (tab viên thuốc, thẻ khách, lọc nhanh) vẽ bằng token Admin; phân trang = `Pagination` của Admin.
import { useMemo, useState } from 'react';
import { ArrowUpDown, CircleX, Plus, Search, SearchX, SlidersHorizontal } from 'lucide-react';
import { Pagination } from '../../../../components/common/Pagination';
import {
  BUTTON_OUTLINE_BASE_CLASS,
  BUTTON_PRIMARY_CLASS,
  BUTTON_SOFT_BASE_CLASS,
  CARD_CLASS,
  FILTER_INPUT_CLASS,
  PAGE_DESCRIPTION_CLASS,
  PAGE_TITLE_MOBILE_CLASS,
} from '@crm/lib/uiClasses';
import { useCrmActions, useCrmState, useFilteredCustomers } from '@crm/store';
import { CustomerCard } from './components/CustomerCard';
import { CustomerStatusPills } from './components/CustomerStatusPills';
import { getPageSlice, sortCustomers, toPaginationMeta, type CustomerSortKey } from './customerListHelpers';

/** Số thẻ / trang trên app. */
const MOBILE_PAGE_SIZE = 10;
const FIRST_PAGE = 1;

/** App chỉ có nút đảo 2 kiểu sắp xếp (như Stitch mobile). */
type MobileSortKey = Extract<CustomerSortKey, 'newest' | 'progress'>;
const MOBILE_SORT_LABELS: Record<MobileSortKey, string> = {
  newest: 'Mới cập nhật',
  progress: 'Theo tiến độ',
};

const QUICK_FILTER_SIZE_CLASS = 'h-9 shrink-0 whitespace-nowrap px-3 text-xs';

export const CustomersMobile = () => {
  const { filters } = useCrmState();
  const filteredCustomers = useFilteredCustomers();
  const { navigate, setFilters, openAdvancedFilter } = useCrmActions();
  const [sortKey, setSortKey] = useState<MobileSortKey>('newest');
  const [currentPage, setCurrentPage] = useState(FIRST_PAGE);

  const sortedCustomers = useMemo(() => sortCustomers(filteredCustomers, sortKey), [filteredCustomers, sortKey]);
  const pageSlice = getPageSlice(sortedCustomers, currentPage, MOBILE_PAGE_SIZE);
  const advancedFilterCount = filters.projectsSelected.length;
  const hasAdvancedFilter = advancedFilterCount > 0;
  const resetToFirstPage = () => setCurrentPage(FIRST_PAGE);

  const updateSearch = (search: string) => {
    setFilters({ search });
    resetToFirstPage();
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Tiêu đề + nút chính */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={PAGE_TITLE_MOBILE_CLASS}>Quản lý khách hàng</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} mt-0.5`}>Theo dõi, phân loại và chăm sóc khách hàng.</p>
        </div>
        <button type="button" onClick={() => navigate('create_customer')} className={`${BUTTON_PRIMARY_CLASS} h-10 shrink-0`}>
          <Plus size={18} aria-hidden="true" />
          Thêm khách
        </button>
      </header>

      <CustomerStatusPills onChange={resetToFirstPage} />

      {/* Tìm kiếm + lọc nhanh */}
      <section aria-label="Tìm kiếm và bộ lọc" className={`${CARD_CLASS} space-y-2.5 p-3`}>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            inputMode="search"
            aria-label="Tìm khách hàng"
            value={filters.search}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder="Tên, SĐT, mã KH, dự án..."
            className={`${FILTER_INPUT_CLASS} w-full pl-10 pr-10`}
          />
          {filters.search && (
            <button
              type="button"
              aria-label="Xoá từ khoá"
              onClick={() => updateSearch('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <CircleX size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => {
              setSortKey(sortKey === 'newest' ? 'progress' : 'newest');
              resetToFirstPage();
            }}
            className={`${BUTTON_OUTLINE_BASE_CLASS} ${QUICK_FILTER_SIZE_CLASS} gap-1`}
          >
            <ArrowUpDown size={14} aria-hidden="true" />
            {MOBILE_SORT_LABELS[sortKey]}
          </button>
          <button
            type="button"
            onClick={openAdvancedFilter}
            className={`${hasAdvancedFilter ? BUTTON_SOFT_BASE_CLASS : BUTTON_OUTLINE_BASE_CLASS} ${QUICK_FILTER_SIZE_CLASS} ml-auto gap-1`}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Bộ lọc nâng cao
            {hasAdvancedFilter && (
              <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {advancedFilterCount}
              </span>
            )}
          </button>
        </div>
      </section>

      <p className="px-1 text-theme-xs text-gray-500 dark:text-gray-400" aria-live="polite">
        {sortedCustomers.length} khách phù hợp
        {hasAdvancedFilter && ` · đang lọc ${advancedFilterCount} dự án`}
      </p>

      {/* Danh sách thẻ khách */}
      <div className="flex flex-col gap-3">
        {pageSlice.pageItems.map((customer) => (
          <CustomerCard key={customer.id} customer={customer} />
        ))}
        {pageSlice.pageItems.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 p-8 text-center dark:border-white/[0.1]">
            <SearchX size={28} className="text-gray-400" aria-hidden="true" />
            <p className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">Không có khách hàng phù hợp</p>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">Thử đổi tình trạng, từ khoá hoặc bộ lọc nâng cao.</p>
          </div>
        )}
      </div>

      <Pagination
        meta={toPaginationMeta(pageSlice, sortedCustomers.length, MOBILE_PAGE_SIZE)}
        onPageChange={setCurrentPage}
        itemLabel="khách"
      />
    </div>
  );
};

export default CustomersMobile;
