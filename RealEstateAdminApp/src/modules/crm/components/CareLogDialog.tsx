/**
 * Ghi chú tại chỗ ở các màn KHÔNG phải chi tiết khách (Việc hôm nay, Danh sách khách, Lịch hẹn): hộp thoại (web) / bottom sheet (app)
 * chứa FORM ĐẦY ĐỦ như tab Nhật ký của chi tiết khách (nội dung, kênh liên hệ, kết quả, nhắc việc tiếp theo, ảnh khi bật cờ ảnh).
 * Không chuyển trang: người dùng ghi xong ở đúng chỗ đang làm việc.
 *
 * Tái dùng toàn bộ logic của chi tiết khách: `CareLogComposer` (form + hộp "Bỏ thay đổi chưa lưu?") + `CareLogForm` (lưu, tải/dọn ảnh mồ côi,
 * làm mới dữ liệu sau khi lưu qua `useCustomerDetailActions`) + `useNoteComposer` (chống mất bản nháp). Phần này chỉ là vỏ.
 * - Web: vỏ `components/ui/modal` (Esc/khoá cuộn do Modal lo).
 * - App: `BottomSheet` (cuộn được, nút Lưu dính đáy, nâng lên trên bàn phím ảo).
 * Đóng (X / Esc / nền / Hủy) khi còn bản nháp thì hỏi lại; đang lưu thì bỏ qua.
 * Trợ năng: role=dialog + aria-modal + aria-labelledby; Tab xoay vòng trong hộp (`useFocusTrap`), đóng thì trả tiêu điểm về nút đã mở.
 */
import { useEffect } from 'react';
import { NotebookPen, X } from 'lucide-react';
import type { CustomerDetail } from '@crm/api';
import { Modal } from '../../../components/ui/modal';
import { useFocusTrap } from '@crm/hooks/useFocusTrap';
import { ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';
import { hasPhone } from '@crm/lib/phone';
import { CareLogComposer } from '@crm/screens/CustomerDetail/components/CareLogComposer';
import { useNoteComposer } from '@crm/screens/CustomerDetail/useNoteComposer';
import { BottomSheet } from './BottomSheet';

export type CareLogDialogVariant = 'dialog' | 'sheet';

const TITLE_ID = 'crm-care-log-dialog-title';
const CREATE_STATE = { kind: 'create' } as const;

interface CareLogDialogProps {
  customer: CustomerDetail;
  /** 'dialog' = modal giữa màn (web), 'sheet' = trượt từ đáy (app). */
  variant: CareLogDialogVariant;
  onClose: () => void;
}

export const CareLogDialog = ({ customer, variant, onClose }: CareLogDialogProps) => {
  const composer = useNoteComposer(customer.id, { initialState: CREATE_STATE, onClosed: onClose });
  const { pending, requestClose } = composer;
  const isSheet = variant === 'sheet';
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Hộp "Bỏ thay đổi chưa lưu?" là `Modal` lồng: mỗi lần nó mở/đóng đều nhả khóa cuộn của body. Khóa lại sau mỗi lần `pending` đổi
  // (effect của con chạy trước effect của cha nên lần khóa này luôn thắng). `Modal` ngoài tự nhả khi gỡ hộp; bottom sheet tự khóa lại.
  useEffect(() => {
    if (!isSheet) document.body.style.overflow = 'hidden';
  }, [isSheet, pending]);

  // Đang hiện hộp "Bỏ thay đổi chưa lưu?" thì Esc/nền chỉ đóng hộp đó (do ConfirmDialog lo), không hỏi chồng.
  const handleRequestClose = () => {
    if (pending === null) requestClose();
  };

  const form = <CareLogComposer customer={customer} variant={isSheet ? 'mobile' : 'desktop'} layout="dialog" composer={composer} />;

  if (isSheet) {
    return (
      <BottomSheet titleId={TITLE_ID} title="Ghi chú chăm sóc" subtitle={hasPhone(customer.phoneMasked) ? `${customer.fullName} · ${customer.phoneMasked}` : customer.fullName} onClose={handleRequestClose}>
        {/* Bottom sheet dùng chung không có trap: chỉ vùng form (gồm Hủy/Lưu) được giữ tiêu điểm; nút đóng ở đầu sheet vẫn bấm/chạm được. */}
        <div ref={trapRef}>{form}</div>
      </BottomSheet>
    );
  }

  return (
    <Modal isOpen onClose={handleRequestClose} showCloseButton={false} className="mx-4 max-w-xl p-6">
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={TITLE_ID}>
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
            <NotebookPen size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Ghi chú chăm sóc — {customer.fullName}
            </h3>
            {hasPhone(customer.phoneMasked) && <p className="text-theme-sm text-gray-500 dark:text-gray-400">SĐT: {customer.phoneMasked}</p>}
          </div>
          <button type="button" onClick={handleRequestClose} aria-label="Đóng hộp ghi chú" title="Đóng" className={ICON_BUTTON_CLASS}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {form}
      </div>
    </Modal>
  );
};
