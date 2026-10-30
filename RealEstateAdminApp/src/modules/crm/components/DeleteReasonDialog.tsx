/**
 * Hộp xác nhận XÓA khách có ô LÝ DO bắt buộc (≤ 500 ký tự, có đếm ký tự): dùng cho xóa hàng loạt (BulkActionBar) và xóa một khách
 * (chi tiết khách). Nút Xóa chỉ bật khi lý do hợp lệ; lỗi của lần gọi trước hiện ngay trong hộp (giữ nguyên lý do đã nhập).
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { DialogFrame } from '@crm/components/DialogFrame';
import { DELETE_REASON_MAX_LENGTH, validateDeleteReason } from '@crm/lib/customerDeletion';
import { BUTTON_OUTLINE_CLASS, DANGER_BUTTON_CLASS, FORM_HINT_CLASS, FORM_LABEL_CLASS, MODAL_INPUT_CLASS } from '@crm/lib/uiClasses';

interface DeleteReasonDialogProps {
  isOpen: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  isSubmitting?: boolean;
  /** Lỗi của lần xóa trước (hiện trong hộp, giữ lý do đã nhập). */
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

interface ReasonFormProps extends Omit<DeleteReasonDialogProps, 'isOpen' | 'title'> {
  reason: string;
  descriptionId: string;
  onReasonChange: (reason: string) => void;
}

const ReasonForm = ({ description, descriptionId, confirmLabel, isSubmitting, error, reason, onReasonChange, onConfirm, onCancel }: ReasonFormProps) => {
  const fieldId = useId();
  const validationMessage = validateDeleteReason(reason);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (validationMessage || isSubmitting) return;
    onConfirm(reason.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div id={descriptionId} className="text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {description}
      </div>
      <div>
        <label htmlFor={fieldId} className={FORM_LABEL_CLASS}>
          Lý do xóa <span className="text-error-500 dark:text-error-400">*</span>
        </label>
        <textarea
          id={fieldId}
          data-autofocus
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          maxLength={DELETE_REASON_MAX_LENGTH}
          rows={3}
          aria-required="true"
          aria-describedby={`${fieldId}-hint`}
          placeholder="Ví dụ: khách trùng, khách không còn nhu cầu, nhập nhầm…"
          className={MODAL_INPUT_CLASS}
        />
        <p id={`${fieldId}-hint`} className={`${FORM_HINT_CLASS} flex justify-between gap-2`}>
          <span>{reason.trim().length === 0 ? 'Bắt buộc. Lý do được ghi vào lịch sử.' : ' '}</span>
          <span aria-live="polite">
            {reason.length}/{DELETE_REASON_MAX_LENGTH}
          </span>
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3 pt-1">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={BUTTON_OUTLINE_CLASS}>
          Huỷ
        </button>
        <button type="submit" disabled={validationMessage !== null || isSubmitting} className={DANGER_BUTTON_CLASS}>
          {isSubmitting ? 'Đang xóa…' : confirmLabel}
        </button>
      </div>
    </form>
  );
};

export const DeleteReasonDialog = ({ isOpen, title, description, confirmLabel = 'Xóa', isSubmitting = false, error = null, onConfirm, onCancel }: DeleteReasonDialogProps) => {
  // Lý do nằm ở đây (không trong form) để biết người dùng đang nhập dở: khi đó nhấp nền KHÔNG đóng hộp (Esc/Huỷ vẫn đóng). Đóng thì xóa lý do.
  const [reason, setReason] = useState('');
  const descriptionId = useId();
  useEffect(() => {
    if (!isOpen) setReason('');
  }, [isOpen]);

  return (
    <DialogFrame isOpen={isOpen} title={title} role="alertdialog" describedById={descriptionId} isBackdropClosable={reason.trim().length === 0 && !isSubmitting} onClose={isSubmitting ? () => undefined : onCancel}>
      <ReasonForm description={description} descriptionId={descriptionId} confirmLabel={confirmLabel} isSubmitting={isSubmitting} error={error} reason={reason} onReasonChange={setReason} onConfirm={onConfirm} onCancel={onCancel} />
    </DialogFrame>
  );
};
