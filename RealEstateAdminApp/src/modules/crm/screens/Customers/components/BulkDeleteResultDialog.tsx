/**
 * Kết quả xóa hàng loạt THEO TỪNG KHÁCH: danh sách đã xóa + danh sách không xóa được kèm lý do tiếng Việt theo mã lỗi.
 * Chỉ mở khi có khách lỗi (xóa trọn lô thì chỉ cần toast).
 */
import { CheckCircle2, XCircle } from 'lucide-react';
import type { BulkResult } from '@crm/api';
import { DialogFrame } from '@crm/components/DialogFrame';
import { describeBulkDeleteError } from '@crm/lib/customerDeletion';
import { BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';

interface BulkDeleteResultDialogProps {
  result: BulkResult | null;
  /** Tên khách theo id (khách không còn trong danh sách đã tải thì hiện "Khách không rõ"). */
  getCustomerName: (customerId: string) => string;
  onClose: () => void;
}

const ITEM_CLASS = 'flex items-start gap-2 text-theme-sm';

/** Khách lỗi vẫn còn được chọn (để xử lý tiếp): trừ khách không còn trong phạm vi (CUSTOMER_NOT_FOUND) vì không còn hàng nào để chọn. */
export const countKeptSelected = (result: BulkResult): number => result.failed.filter((item) => item.errorCode !== 'CUSTOMER_NOT_FOUND').length;

export const BulkDeleteResultDialog = ({ result, getCustomerName, onClose }: BulkDeleteResultDialogProps) => (
  <DialogFrame isOpen={result !== null} title="Kết quả xóa khách" size="lg" onClose={onClose}>
    {result && (
      <>
        <p className="text-theme-sm text-gray-600 dark:text-gray-400">
          Đã xóa <strong className="text-gray-800 dark:text-white/90">{result.succeeded.length}</strong> khách; <strong className="text-error-600 dark:text-error-400">{result.failed.length}</strong> khách không xóa được
          {countKeptSelected(result) > 0 ? ` (${countKeptSelected(result)} khách trong số đó vẫn đang được chọn để bạn xử lý tiếp).` : '.'}
        </p>
        <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
          {result.failed.length > 0 && (
            <section aria-label="Khách không xóa được">
              <ul className="space-y-2">
                {result.failed.map((item) => (
                  <li key={item.customerId} className={ITEM_CLASS}>
                    <XCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-error-500" />
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">
                      <strong className="font-medium">{getCustomerName(item.customerId)}</strong>: {describeBulkDeleteError(item.errorCode)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.succeeded.length > 0 && (
            <section aria-label="Khách đã xóa">
              <ul className="space-y-2">
                {result.succeeded.map((customerId) => (
                  <li key={customerId} className={ITEM_CLASS}>
                    <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success-500" />
                    <span className="min-w-0 break-words text-gray-700 dark:text-gray-300">
                      <strong className="font-medium">{getCustomerName(customerId)}</strong>: đã xóa (Quản trị có thể khôi phục ở màn "Khách đã xóa")
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
