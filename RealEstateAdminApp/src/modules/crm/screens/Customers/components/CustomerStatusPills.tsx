/**
 * Tab danh sách dạng viên thuốc có số đếm (C6): Đang chăm sóc / Khách net / Bỏ / Tất cả.
 * Số đếm lấy từ `GET /crm/customers/list-counts` với CÙNG bộ lọc (trừ tab) -> luôn khớp số dòng của tab.
 */
import type { ListCounts } from '@crm/api';
import { PILL_ACTIVE_CLASS, PILL_COUNT_ACTIVE_CLASS, PILL_COUNT_IDLE_CLASS, PILL_IDLE_CLASS } from '@crm/lib/uiClasses';
import type { CustomerListTab } from '@crm/types/app';
import { LIST_TABS } from '../customerListHelpers';

const PILL_BASE_CLASS =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors active:scale-[0.98]';

interface CustomerStatusPillsProps {
  activeTab: CustomerListTab;
  counts: ListCounts;
  onChange: (tab: CustomerListTab) => void;
}

export const CustomerStatusPills = ({ activeTab, counts, onChange }: CustomerStatusPillsProps) => (
  <div role="group" aria-label="Danh sách theo tình trạng" className="no-scrollbar flex items-center gap-2 overflow-x-auto">
    {LIST_TABS.map((tab) => {
      const isActive = activeTab === tab.value;
      return (
        <button
          key={tab.value}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(tab.value)}
          className={`${PILL_BASE_CLASS} ${isActive ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
        >
          <span>{tab.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isActive ? PILL_COUNT_ACTIVE_CLASS : PILL_COUNT_IDLE_CLASS}`}>
            {counts[tab.value]}
          </span>
        </button>
      );
    })}
  </div>
);
