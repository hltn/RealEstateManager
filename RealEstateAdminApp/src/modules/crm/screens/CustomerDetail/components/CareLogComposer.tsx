// Chỗ đặt form ghi chú ở tab Nhật ký (PT-020, PT-022): mặc định chỉ có nút "Ghi chú"; form ĐẦY ĐỦ chỉ hiện khi bấm nút này
// (hoặc nút "Ghi chú" ở đầu hồ sơ) hoặc khi bấm "Sửa" trên một nhật ký (mở lại với dữ liệu cũ).
// Form còn thay đổi chưa lưu mà bị thay/đóng (bấm "Sửa" nhật ký khác, Hủy/X) thì hỏi lại, không để mất bản nháp âm thầm.
import { NotebookPen } from 'lucide-react';
import type { CustomerDetail } from '@crm/api';
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import { ICON_BUTTON_OUTLINE_CLASS } from '@crm/lib/uiClasses';
import type { NoteComposer } from '../useNoteComposer';
import { CareLogForm } from './CareLogForm';

interface CareLogComposerProps {
  customer: CustomerDetail;
  variant: 'desktop' | 'mobile';
  composer: NoteComposer;
  /** 'dialog' = form nằm trong hộp thoại/bottom sheet (không khung thẻ); xem `CareLogForm`. */
  layout?: 'card' | 'dialog';
}

export const CareLogComposer = ({ customer, variant, composer, layout }: CareLogComposerProps) => {
  const { state, pending, openCreate, close, requestClose, confirmPending, cancelPending, reportGuard } = composer;

  if (state.kind === 'closed') {
    return (
      <div>
        <button type="button" onClick={openCreate} className={`${ICON_BUTTON_OUTLINE_CLASS} w-full gap-1.5 text-sm md:w-auto`}>
          <NotebookPen size={16} aria-hidden="true" />
          Ghi chú
        </button>
      </div>
    );
  }

  // `key`: đổi giữa thêm mới / sửa nhật ký khác thì dựng lại form (reset dữ liệu nhập + ảnh).
  return (
    <>
      <CareLogForm
        key={state.kind === 'edit' ? state.log.id : 'create'}
        customer={customer}
        variant={variant}
        layout={layout}
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
