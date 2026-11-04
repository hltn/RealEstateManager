/**
 * Cụm nút liên hệ trong ô "Thao tác" của bảng (bảng khách, bảng việc hôm nay).
 * Mẫu "nút trong bảng" Admin (`ManageWpScreen.tsx:937-979`: text-xs font-semibold px-2 py-1 rounded-lg + icon 14px)
 * với tông nhạt brand (Gọi) / success (Zalo) như Admin Stitch, và "nút icon trong bảng" (`ExternalLogsScreen.tsx:365`)
 * cho Ghi chú nhanh. Chặn click lan lên `<tr>` (dòng bảng bấm được để mở chi tiết).
 */
import { MessageCircle, NotebookPen, Phone } from 'lucide-react';
import { useContactActions } from '@crm/hooks/useContactActions';
import { ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';

const TABLE_ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition-colors active:scale-95';

interface TableContactActionsProps {
  customerId: string;
  customerName: string;
}

export const TableContactActions = ({ customerId, customerName }: TableContactActionsProps) => {
  const { callCustomer, messageZalo, openQuickNote } = useContactActions();

  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => callCustomer(customerId)}
        title="Gọi điện"
        className={`${TABLE_ACTION_BUTTON_CLASS} border-brand-100 bg-brand-50 text-brand-500 hover:bg-brand-100 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400 dark:hover:bg-brand-500/25`}
      >
        <Phone size={14} aria-hidden="true" />
        <span>Gọi</span>
      </button>
      <button
        type="button"
        onClick={() => messageZalo(customerId)}
        title="Nhắn Zalo"
        className={`${TABLE_ACTION_BUTTON_CLASS} border-success-100 bg-success-50 text-success-600 hover:bg-success-100 dark:border-success-500/25 dark:bg-success-500/15 dark:text-success-500 dark:hover:bg-success-500/25`}
      >
        <MessageCircle size={14} aria-hidden="true" />
        <span>Zalo</span>
      </button>
      <button
        type="button"
        onClick={() => openQuickNote(customerId)}
        title="Ghi chú nhanh"
        aria-label={`Ghi chú nhanh cho ${customerName}`}
        className={ICON_BUTTON_CLASS}
      >
        <NotebookPen size={18} aria-hidden="true" />
      </button>
    </div>
  );
};
