// Hàng "← Quay lại" + tiêu đề của màn chi tiết (Mobile CustomerDetailView).
// Nằm TRONG nội dung (không sticky/fixed): header + drawer phía trên là `AppHeader`/`AppSidebar` của Admin,
// nên không vẽ thêm top app bar thứ hai như bản Stitch.
import { ArrowLeft, Pencil } from 'lucide-react';
import { CustomerCodeBadge } from '@crm/components/CustomerCodeBadge';
import { useCrmActions } from '@crm/store';
import { BUTTON_LINK_CLASS } from '@crm/lib/uiClasses';

interface MobileDetailHeaderProps {
  customerName: string;
  /** Mã khách `KH-…` hiện ở mọi vai trò; `null` = khách cũ chưa có mã (không vẽ gì). */
  customerCode: string | null;
}

export const MobileDetailHeader = ({ customerName, customerCode }: MobileDetailHeaderProps) => {
  const { goBack, navigate } = useCrmActions();

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Quay lại"
          title="Quay lại"
          onClick={goBack}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition hover:bg-gray-50 active:scale-95 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
            Quản lý khách hàng
            <CustomerCodeBadge code={customerCode} />
          </p>
          <h1 className="truncate text-lg font-semibold text-gray-800 dark:text-white/90">{customerName}</h1>
        </div>
      </div>

      <button type="button" onClick={() => navigate('edit_persona')} className={BUTTON_LINK_CLASS}>
        <Pencil size={14} aria-hidden="true" />
        Chỉnh sửa
      </button>
    </div>
  );
};
