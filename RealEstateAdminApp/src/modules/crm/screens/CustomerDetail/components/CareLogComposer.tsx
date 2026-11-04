// Chỗ đặt form ghi chú ở tab Nhật ký (PT-020, PT-022): mặc định KHÔNG hiện gì; form ĐẦY ĐỦ chỉ hiện khi bấm "Ghi chú"
// (ở thanh đáy mobile, đầu thẻ "Nhật ký chăm sóc" desktop, hoặc đầu hồ sơ) hoặc khi bấm "Sửa" trên một nhật ký (mở lại với dữ liệu cũ).
// PT-028: nút "Ghi chú" riêng ở trạng thái đóng (đứng lửng lơ dưới thanh tab) đã bỏ: mobile chuyển xuống `MobileContactFooter`,
// desktop chuyển lên đầu thẻ `CareTimeline` (prop `onAddNote`); component này chỉ lo phần form khi đã mở.
// Form còn thay đổi chưa lưu mà bị thay/đóng (bấm "Sửa" nhật ký khác, Hủy/X) thì hỏi lại, không để mất bản nháp âm thầm.
import type { CustomerDetail } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import type { NoteComposer } from '../useNoteComposer';
import { CareLogForm } from './CareLogForm';

interface CareLogComposerProps {
  customer: CustomerDetail;
  variant: 'desktop' | 'mobile';
  composer: NoteComposer;
  /** 'dialog' = form nằm trong hộp thoại/bottom sheet (không khung thẻ); xem `CareLogForm`. */
  layout?: 'card' | 'dialog';
  /** Đổi giá trị = cuộn + focus lại form đang mở (xem `CareLogForm`). */
  focusSignal?: number;
}

export const CareLogComposer = ({ customer, variant, composer, layout, focusSignal }: CareLogComposerProps) => {
  const { state, pending, close, requestClose, confirmPending, cancelPending, reportGuard } = composer;

  // Đóng: không dựng gì (nút mở form nằm ở chỗ khác, xem comment đầu file).
  if (state.kind === 'closed') return null;

  // `key`: đổi giữa thêm mới / sửa nhật ký khác thì dựng lại form (reset dữ liệu nhập + ảnh).
  return (
    <>
      <CareLogForm
        key={state.kind === 'edit' ? state.log.id : 'create'}
        customer={customer}
        variant={variant}
        layout={layout}
        focusSignal={focusSignal}
        editingLog={state.kind === 'edit' ? state.log : undefined}
        onClose={close}
        onCancel={requestClose}
        onGuardChange={reportGuard}
      />
      <ConfirmDialog
        isOpen={pending !== null}
        role="dialog"
        tone="danger"
        title="Bỏ thay đổi chưa lưu?"
        description="Nội dung và ảnh bạn vừa nhập ở form ghi chú chưa được lưu và sẽ mất."
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Tiếp tục nhập"
        onConfirm={confirmPending}
        onCancel={cancelPending}
      />
    </>
  );
};
