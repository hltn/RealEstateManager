/**
 * Hộp xác nhận khi bấm "Hủy bỏ" lúc form lịch hẹn còn thay đổi chưa lưu (form không có bản nháp: rời đi là mất dữ liệu đã nhập).
 */
import { ConfirmDialog } from '@crm/components/ConfirmDialog';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';

interface DiscardChangesDialogProps {
  form: Pick<CreateAppointmentForm, 'isConfirmingDiscard' | 'confirmDiscard' | 'keepEditing'>;
}

export const DiscardChangesDialog = ({ form }: DiscardChangesDialogProps) => (
  <ConfirmDialog
    isOpen={form.isConfirmingDiscard}
    role="dialog"
    tone="danger"
    title="Bỏ lịch hẹn đang nhập?"
    description="Thông tin bạn đã nhập chưa được lưu và sẽ mất nếu rời khỏi form."
    confirmLabel="Bỏ thay đổi"
    cancelLabel="Tiếp tục nhập"
    onConfirm={form.confirmDiscard}
    onCancel={form.keepEditing}
  />
);
