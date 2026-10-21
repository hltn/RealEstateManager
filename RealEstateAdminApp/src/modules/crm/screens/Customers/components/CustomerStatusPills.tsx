/**
 * Tab trạng thái dạng viên thuốc có số đếm (Admin + Mobile Stitch) — Admin App chưa có
 * (tài liệu 03 mục 10: "Làm mới") → vẽ theo Stitch bằng token Admin:
 * chọn = `bg-brand-500 text-white` (như trang hiện tại của `Pagination`), thường = nút viền Admin + chip đếm xám.
 * Ghi vào `filters.status` của store (dùng chung web/app). Số đếm lấy từ dữ liệu thật.
 * Dùng cho cả web và app (app cuộn ngang).
 */
import { useMemo } from 'react';
import { PILL_ACTIVE_CLASS, PILL_COUNT_ACTIVE_CLASS, PILL_COUNT_IDLE_CLASS, PILL_IDLE_CLASS } from '@crm/lib/uiClasses';
import { selectCustomerCountByStatus, useCrmActions, useCrmState } from '@crm/store';
import type { CustomerStatus } from '@crm/types/crm';
import type { CustomerStatusTab } from '../customerListHelpers';

interface StatusPillConfig {
  value: CustomerStatusTab;
  label: string;
  /** null = tab "Tất cả" (đếm toàn bộ khách). */
  status: CustomerStatus | null;
}

const STATUS_PILLS: StatusPillConfig[] = [
  { value: 'all', label: 'Tất cả', status: null },
  { value: 'caring', label: 'Đang chăm sóc', status: 'Có quan tâm' },
  { value: 'hot', label: 'Khách net', status: 'Khách net' },
  { value: 'dropped', label: 'Bỏ', status: 'Bỏ / Không nhu cầu' },
];

const PILL_BASE_CLASS =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors active:scale-[0.98]';

interface CustomerStatusPillsProps {
  /** Gọi sau khi đổi tab (màn dùng để quay về trang 1). */
  onChange: () => void;
}

export const CustomerStatusPills = ({ onChange }: CustomerStatusPillsProps) => {
  const state = useCrmState();
  const { setFilters } = useCrmActions();
  const countByStatus = useMemo(() => selectCustomerCountByStatus(state), [state]);
  const activeStatus = state.filters.status;

  const handleSelect = (status: CustomerStatusTab) => {
    setFilters({ status });
    onChange();
  };

  return (
    <div role="group" aria-label="Lọc theo tình trạng" className="flex items-center gap-2 overflow-x-auto no-scrollbar">
      {STATUS_PILLS.map((pill) => {
        const isActive = activeStatus === pill.value;
        const count = pill.status ? countByStatus[pill.status] : state.customers.length;
        return (
          <button
            key={pill.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => handleSelect(pill.value)}
            className={`${PILL_BASE_CLASS} ${isActive ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
          >
            <span>{pill.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isActive ? PILL_COUNT_ACTIVE_CLASS : PILL_COUNT_IDLE_CLASS}`}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
};
