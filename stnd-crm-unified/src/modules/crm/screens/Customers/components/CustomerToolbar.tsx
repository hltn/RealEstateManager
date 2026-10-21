/**
 * Thanh lọc của bảng khách (web) — mẫu "thanh lọc" Admin (`ExternalLogsScreen.tsx:202-293`):
 * thẻ `rounded-2xl border p-4`, mỗi trường `flex flex-col gap-1.5` nhãn trên; ô tìm có icon kiểu
 * `ManageWpScreen.tsx:738-748`. Nội dung trường theo Admin Stitch `CustomerListView`.
 * - Tìm kiếm / Dự án / Người phụ trách ghi vào `filters` của store (dùng chung với bản app).
 * - Sắp xếp là state cục bộ của màn (không thuộc FilterOptions).
 * - Nút "Bộ lọc nâng cao" (Stitch web không có) để thấy/sửa `projectsSelected` + thời gian.
 */
import { Search, SlidersHorizontal } from 'lucide-react';
import {
  BUTTON_OUTLINE_BASE_CLASS,
  BUTTON_SOFT_BASE_CLASS,
  CAPTION_CLASS,
  FILTER_INPUT_CLASS,
} from '@crm/lib/uiClasses';
import { PROJECT_NAMES, STAFF_LIST } from '@crm/data/mockData';
import { useCrmActions, useCrmState } from '@crm/store';
import type { FilterOptions } from '@crm/types/crm';
import { CUSTOMER_SORT_OPTIONS, type CustomerSortKey } from '../customerListHelpers';

interface CustomerToolbarProps {
  sortKey: CustomerSortKey;
  onSortChange: (sortKey: CustomerSortKey) => void;
  /** Gọi sau khi đổi bộ lọc (màn dùng để quay về trang 1). */
  onFilterChange: () => void;
}

export const CustomerToolbar = ({ sortKey, onSortChange, onFilterChange }: CustomerToolbarProps) => {
  const { filters } = useCrmState();
  const { setFilters, openAdvancedFilter } = useCrmActions();
  const advancedFilterCount = filters.projectsSelected.length;
  const hasAdvancedFilter = advancedFilterCount > 0;

  const updateFilters = (changes: Partial<FilterOptions>) => {
    setFilters(changes);
    onFilterChange();
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:flex-row md:flex-wrap md:items-end dark:border-white/[0.05] dark:bg-white/[0.03]">
      <div className="flex flex-col gap-1.5 md:min-w-[240px] md:flex-1">
        <label htmlFor="customer-search" className={CAPTION_CLASS}>
          Tìm kiếm
        </label>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="customer-search"
            type="search"
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder="Tên, SĐT, mã KH, dự án..."
            className={`${FILTER_INPUT_CLASS} w-full pl-10`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="customer-sort" className={CAPTION_CLASS}>
          Sắp xếp
        </label>
        <select
          id="customer-sort"
          value={sortKey}
          onChange={(event) => onSortChange(event.target.value as CustomerSortKey)}
          className={`${FILTER_INPUT_CLASS} md:min-w-[170px]`}
        >
          {CUSTOMER_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="customer-project" className={CAPTION_CLASS}>
          Dự án
        </label>
        <select
          id="customer-project"
          value={filters.project}
          onChange={(event) => updateFilters({ project: event.target.value })}
          className={`${FILTER_INPUT_CLASS} md:min-w-[150px]`}
        >
          <option value="all">Tất cả</option>
          {PROJECT_NAMES.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="customer-staff" className={CAPTION_CLASS}>
          Người phụ trách
        </label>
        <select
          id="customer-staff"
          value={filters.staff}
          onChange={(event) => updateFilters({ staff: event.target.value })}
          className={`${FILTER_INPUT_CLASS} md:min-w-[150px]`}
        >
          <option value="all">Tất cả</option>
          {STAFF_LIST.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={openAdvancedFilter}
        className={`h-10 px-4 text-sm ${hasAdvancedFilter ? BUTTON_SOFT_BASE_CLASS : BUTTON_OUTLINE_BASE_CLASS}`}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>Bộ lọc nâng cao</span>
        {hasAdvancedFilter && (
          <span
            className="rounded-full bg-brand-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
            aria-label={`${advancedFilterCount} dự án đang lọc`}
          >
            {advancedFilterCount}
          </span>
        )}
      </button>
    </div>
  );
};
