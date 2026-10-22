/**
 * Bộ 4 nút liên hệ của thẻ khách / thẻ việc (Gọi · Zalo · Ghi chú · Xem) — bố cục theo Stitch
 * (Admin DailyTasksView: 4 cột; Mobile: lưới 2x2), màu theo token Admin:
 * Gọi = nút chính brand (1 nút brand / thẻ), Zalo = success, Ghi chú = nút xám, Xem = nút viền.
 * Hành vi gọi/Zalo phụ thuộc thiết bị → lấy từ `useContactActions` (web mở modal, app mở tel:/toast).
 */
import { Eye, MessageCircle, NotebookPen, Phone } from 'lucide-react';
import { useContactActions } from '@crm/hooks/useContactActions';
import { useCrmActions } from '@crm/store';
import { BUTTON_GRAY_BASE_CLASS, BUTTON_OUTLINE_BASE_CLASS } from '@crm/lib/uiClasses';

const ACTION_BUTTON_SIZE_CLASS = 'h-9 px-2 text-xs font-medium';

interface ContactActionGridProps {
  customerId: string;
  /** 2 = lưới 2x2 (mobile), 4 = 1 hàng 4 nút (thẻ kanban desktop). */
  columns?: 2 | 4;
  className?: string;
}

export const ContactActionGrid = ({ customerId, columns = 2, className = '' }: ContactActionGridProps) => {
  const { callCustomer, messageZalo, openQuickNote } = useContactActions();
  const { selectCustomer } = useCrmActions();

  return (
    <div className={`grid gap-2 ${columns === 4 ? 'grid-cols-4' : 'grid-cols-2'} ${className}`}>
      <button
        type="button"
        onClick={() => callCustomer(customerId)}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 active:scale-[0.98] dark:bg-brand-600 dark:hover:bg-brand-700 ${ACTION_BUTTON_SIZE_CLASS}`}
      >
        <Phone size={15} aria-hidden="true" />
        <span>Gọi</span>
      </button>
      <button
        type="button"
        onClick={() => messageZalo(customerId)}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-success-600 text-white transition-colors hover:bg-success-700 active:scale-[0.98] dark:bg-success-700 dark:hover:bg-success-800 ${ACTION_BUTTON_SIZE_CLASS}`}
      >
        <MessageCircle size={15} aria-hidden="true" />
        <span>Zalo</span>
      </button>
      <button
        type="button"
        onClick={() => openQuickNote(customerId)}
        className={`${BUTTON_GRAY_BASE_CLASS} ${ACTION_BUTTON_SIZE_CLASS} active:scale-[0.98]`}
      >
        <NotebookPen size={15} aria-hidden="true" />
        <span>Ghi chú</span>
      </button>
      <button
        type="button"
        onClick={() => selectCustomer(customerId)}
        className={`${BUTTON_OUTLINE_BASE_CLASS} ${ACTION_BUTTON_SIZE_CLASS} active:scale-[0.98]`}
      >
        <Eye size={15} aria-hidden="true" />
        <span>Xem</span>
      </button>
    </div>
  );
};
