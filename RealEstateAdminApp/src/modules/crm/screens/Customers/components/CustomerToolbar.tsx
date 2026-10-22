/**
 * Thanh lọc của bảng khách (02 §4.2): tìm kiếm (không dấu) + sắp xếp + Dự án + Khu vực + Người chăm sóc + Bộ lọc nâng cao.
 * Ô chọn nhanh ghi 1 giá trị vào mảng bộ lọc tương ứng; chọn nhiều giá trị/tiêu chí khác ở "Bộ lọc nâng cao".
 */
import { Search, SlidersHorizontal } from 'lucide-react';
import { useCatalogs } from '@crm/api';
import { countActiveAdvancedFilters } from '@crm/lib/customerFilters';
import { BUTTON_OUTLINE_BASE_CLASS, BUTTON_SOFT_BASE_CLASS, CAPTION_CLASS, FILTER_INPUT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { CustomerFilters } from '@crm/types/app';
import { CUSTOMER_SORT_OPTIONS } from '../customerListHelpers';
import type { CustomerListScreen } from '../useCustomerListScreen';

interface CustomerToolbarProps {
  screen: CustomerListScreen;
}

/** Giá trị ô chọn nhanh: đúng 1 giá trị -> giá trị đó; 0 hoặc nhiều -> 'all' / 'multi'. */
const getQuickValue = (values: string[]): string => (values.length === 0 ? 'all' : values.length === 1 ? values[0] : 'multi');

interface QuickSelectProps {
  id: string;
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}

const QuickSelect = ({ id, label, values, options, onChange }: QuickSelectProps) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className={CAPTION_CLASS}>
      {label}
    </label>
    <select
      id={id}
      value={getQuickValue(values)}
      onChange={(event) => onChange(event.target.value === 'all' ? [] : [event.target.value])}
      className={`${FILTER_INPUT_CLASS} md:min-w-[150px] dark:[color-scheme:dark]`}
    >
      <option value="all">Tất cả</option>
      {values.length > 1 && <option value="multi">Nhiều lựa chọn ({values.length})</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

export const CustomerToolbar = ({ screen }: CustomerToolbarProps) => {
  const { filters, sort, setSort, updateFilters } = screen;
  const { catalogs, users } = useCatalogs();
  const { openAdvancedFilter } = useCrmActions();
  const advancedCount = countActiveAdvancedFilters(filters);
  const set = (changes: Partial<CustomerFilters>) => updateFilters(changes);

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
            value={filters.q}
            onChange={(event) => set({ q: event.target.value })}
            placeholder="Tên (có/không dấu), SĐT, mã KH..."
            className={`${FILTER_INPUT_CLASS} w-full pl-10`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="customer-sort" className={CAPTION_CLASS}>
          Sắp xếp
        </label>
        <select id="customer-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={`${FILTER_INPUT_CLASS} md:min-w-[170px] dark:[color-scheme:dark]`}>
          {CUSTOMER_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <QuickSelect
        id="customer-project"
        label="Dự án"
        values={filters.projectIds}
        options={catalogs.projects.filter((project) => project.isActive).map((project) => ({ value: project.id, label: project.name }))}
        onChange={(projectIds) => set({ projectIds })}
      />
      <QuickSelect
        id="customer-area"
        label="Khu vực"
        values={filters.areaIds}
        options={catalogs.areas.filter((area) => area.isActive).map((area) => ({ value: area.id, label: area.name }))}
        onChange={(areaIds) => set({ areaIds })}
      />
      <QuickSelect
        id="customer-assignee"
        label="Người chăm sóc"
        values={filters.assigneeIds}
        options={users.filter((user) => user.isActive && user.role !== 'ADMIN').map((user) => ({ value: user.id, label: user.fullName }))}
        onChange={(assigneeIds) => set({ assigneeIds })}
      />

      <button type="button" onClick={openAdvancedFilter} className={`h-10 px-4 text-sm ${advancedCount > 0 ? BUTTON_SOFT_BASE_CLASS : BUTTON_OUTLINE_BASE_CLASS}`}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>Bộ lọc nâng cao</span>
        {advancedCount > 0 && (
          <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white" aria-label={`${advancedCount} nhóm bộ lọc đang bật`}>
            {advancedCount}
          </span>
        )}
      </button>
    </div>
  );
};
