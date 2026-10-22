// Danh sách khách trên điện thoại: khung là của Admin (AppHeader + drawer) + CrmBottomNav của CrmLayout.
// Tab danh sách + ô tìm (không dấu) + sắp xếp + Bộ lọc nâng cao (bottom sheet), thẻ khách, phân trang Admin.
import { ArrowUpDown, CircleX, Plus, Search, SearchX, SlidersHorizontal } from 'lucide-react';
import { Pagination } from '../../../../components/common/Pagination';
import { countActiveAdvancedFilters } from '@crm/lib/customerFilters';
import {
  BUTTON_OUTLINE_BASE_CLASS,
  BUTTON_PRIMARY_CLASS,
  BUTTON_SOFT_BASE_CLASS,
  CARD_CLASS,
  FILTER_INPUT_CLASS,
  PAGE_DESCRIPTION_CLASS,
  PAGE_TITLE_MOBILE_CLASS,
} from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { CustomerCard } from './components/CustomerCard';
import { CustomerStatusPills } from './components/CustomerStatusPills';
import { CUSTOMER_SORT_OPTIONS } from './customerListHelpers';
import { useCustomerListScreen } from './useCustomerListScreen';

const MOBILE_PAGE_SIZE = 10;
const QUICK_FILTER_SIZE_CLASS = 'h-9 shrink-0 whitespace-nowrap px-3 text-xs';

export const CustomersMobile = () => {
  const screen = useCustomerListScreen(MOBILE_PAGE_SIZE);
  const { list, counts, filters, sort, setSort, updateFilters, setPage } = screen;
  const { navigate, openAdvancedFilter } = useCrmActions();
  const advancedCount = countActiveAdvancedFilters(filters);
  const sortIndex = CUSTOMER_SORT_OPTIONS.findIndex((option) => option.value === sort);
  const nextSort = CUSTOMER_SORT_OPTIONS[(sortIndex + 1) % CUSTOMER_SORT_OPTIONS.length];

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={PAGE_TITLE_MOBILE_CLASS}>Quản lý khách hàng</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} mt-0.5`}>Theo dõi và chăm sóc khách hàng.</p>
        </div>
        <button type="button" onClick={() => navigate('create_customer')} className={`${BUTTON_PRIMARY_CLASS} h-10 shrink-0`}>
          <Plus size={18} aria-hidden="true" />
          Thêm khách
        </button>
      </header>

      <CustomerStatusPills activeTab={filters.listGroup} counts={counts} onChange={(listGroup) => updateFilters({ listGroup })} />

      <section aria-label="Tìm kiếm và bộ lọc" className={`${CARD_CLASS} space-y-2.5 p-3`}>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            inputMode="search"
            aria-label="Tìm khách hàng"
            value={filters.q}
            onChange={(event) => updateFilters({ q: event.target.value })}
            placeholder="Tên (có/không dấu), SĐT, mã KH..."
            className={`${FILTER_INPUT_CLASS} w-full pl-10 pr-10`}
          />
          {filters.q && (
            <button
              type="button"
              aria-label="Xoá từ khoá"
              onClick={() => updateFilters({ q: '' })}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <CircleX size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSort(nextSort.value)}
            aria-label={`Sắp xếp: ${CUSTOMER_SORT_OPTIONS[sortIndex]?.label}. Bấm để đổi`}
            className={`${BUTTON_OUTLINE_BASE_CLASS} ${QUICK_FILTER_SIZE_CLASS} gap-1`}
          >
            <ArrowUpDown size={14} aria-hidden="true" />
            {CUSTOMER_SORT_OPTIONS[sortIndex]?.label}
          </button>
          <button
            type="button"
            onClick={openAdvancedFilter}
            className={`${advancedCount > 0 ? BUTTON_SOFT_BASE_CLASS : BUTTON_OUTLINE_BASE_CLASS} ${QUICK_FILTER_SIZE_CLASS} ml-auto gap-1`}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Bộ lọc nâng cao
            {advancedCount > 0 && (
              <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{advancedCount}</span>
            )}
          </button>
        </div>
      </section>

      <p className="px-1 text-theme-xs text-gray-500 dark:text-gray-400" aria-live="polite">
        {list.meta.total} khách phù hợp
      </p>

      <div className="flex flex-col gap-3">
        {list.data.map((customer) => (
          <CustomerCard key={customer.id} customer={customer} />
        ))}
        {list.data.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 p-8 text-center dark:border-white/[0.1]">
            <SearchX size={28} className="text-gray-400" aria-hidden="true" />
            <p className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">{counts.ALL === 0 ? 'Chưa có khách.' : 'Không có khách hàng phù hợp'}</p>
            {counts.ALL === 0 ? (
              <button type="button" onClick={() => navigate('create_customer')} className={`${BUTTON_PRIMARY_CLASS} mt-1`}>
                Thêm khách đầu tiên
              </button>
            ) : (
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">Thử đổi tab, từ khoá hoặc bộ lọc nâng cao.</p>
            )}
          </div>
        )}
      </div>

      <Pagination meta={list.meta} onPageChange={setPage} itemLabel="khách" />
    </div>
  );
};

export default CustomersMobile;
