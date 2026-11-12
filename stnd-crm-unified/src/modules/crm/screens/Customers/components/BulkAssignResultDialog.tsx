/**
 * Kết quả "Thêm thành viên" hàng loạt THEO TỪNG KHÁCH (v1.0.5, FR-14): khách đã thêm được và khách lỗi kèm lý do
 * (`PRIMARY_REQUIRED`, `CARE_TEAM_LIMIT_EXCEEDED`, ...). Chỉ mở khi có khách lỗi (thêm trọn lô thì chỉ cần toast).
 */
import { CheckCircle2, XCircle } from 'lucide-react';
import type { BulkResult } from '@crm/api';
import { DialogFrame } from '@crm/components/DialogFrame';
import { describeCareTeamError } from '@crm/lib/customerRules';
import { BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';

interface BulkAssignResultDialogProps {
  result: BulkResult | null;
  /** Tên khách theo id (khách không còn trong danh sách đã tải thì hiện "Khách không rõ"). */
  getCustomerName: (customerId: string) => string;
  onClose: () => void;
}

const ITEM_CLASS = 'flex items-start gap-2 text-theme-sm';

export const BulkAssignResultDialog = ({ result, getCustomerName, onClose }: BulkAssignResultDialogProps) => (
  <DialogFrame isOpen={result !== null} title="Kết quả thêm thành viên" size="lg" onClose={onClose}>
    {result && (
      <>
        <p className="text-theme-sm text-gray-600 dark:text-gray-400">
          Đã thêm cho <strong className="text-gray-800 dark:text-white/90">{result.succeeded.length}</strong> khách; <strong className="text-error-600 dark:text-error-400">{result.failed.length}</strong> khách không thêm được
          (các khách này vẫn đang được chọn để bạn xử lý tiếp).
        </p>
        <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
          {result.failed.length > 0 && (
            <section aria-label="Khách không thêm được">
              <ul className="space-y-2">
                {result.failed.map((item) => (
                  <li key={item.customerId} className={ITEM_CLASS}>
                    <XCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-error-500" />
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">
                      <strong className="font-medium">{getCustomerName(item.customerId)}</strong>: {describeCareTeamError(item.errorCode)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.succeeded.length > 0 && (
            <section aria-label="Khách đã thêm được">
              <ul className="space-y-2">
                {result.succeeded.map((customerId) => (
                  <li key={customerId} className={ITEM_CLASS}>
                    <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success-500" />
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">
                      <strong className="font-medium">{getCustomerName(customerId)}</strong>: đã thêm thành viên
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="flex justify-end pt-1">
          <button type="button" data-autofocus onClick={onClose} className={BUTTON_PRIMARY_CLASS}>
            Đã hiểu
          </button>
        </div>
      </>
    )}
  </DialogFrame>
);
