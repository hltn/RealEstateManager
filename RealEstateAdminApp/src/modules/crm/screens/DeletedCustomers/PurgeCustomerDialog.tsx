/**
 * Xóa VĨNH VIỄN khách đã xóa mềm — xác nhận HAI BƯỚC vì không hoàn tác:
 * (1) cảnh báo + liệt kê dữ liệu sẽ mất; (2) gõ đúng từ xác nhận thì nút "Xóa vĩnh viễn" mới bật.
 * Lỗi (503 kho tệp lỗi = chưa xóa gì, thử lại được; 404/409) hiện ngay trong hộp, giữ nguyên bước đang đứng.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { DialogFrame } from '@crm/components/DialogFrame';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, DANGER_BUTTON_CLASS, FORM_LABEL_CLASS, MODAL_INPUT_CLASS } from '@crm/lib/uiClasses';
import { hasPhone } from '@crm/lib/phone';

/**
 * Từ gõ để mở khóa nút xóa: ĐÚNG "XOA" hoặc "XÓA" (không phân biệt hoa/thường, cắt khoảng trắng, so sánh NFC).
 * Không nhận biến thể dấu khác (XOẠ, XÒA, XỎA...) hay ký tự thừa/xen kẽ.
 */
export const isPurgeConfirmed = (typed: string): boolean => {
  const word = typed.trim().normalize('NFC').toUpperCase();
  return word === 'XOA' || word === 'XÓA';
};

const LOST_DATA = ['Nhật ký chăm sóc', 'Ảnh và tệp đính kèm (xóa cả tệp trong kho lưu trữ)', 'Lịch hẹn', 'Yêu cầu tham gia nhóm chăm sóc', 'Nhắc việc và thông báo liên quan', 'Lịch sử thay đổi (chỉ còn một dòng ghi nhận đã xóa vĩnh viễn)'];

interface PurgeCustomerDialogProps {
  /** Khách đang xóa vĩnh viễn; `null` = đóng. */
  customer: { id: string; fullName: string; phoneMasked: string | null } | null;
  isSubmitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

interface PurgeStepsProps extends Omit<PurgeCustomerDialogProps, 'customer'> {
  customer: NonNullable<PurgeCustomerDialogProps['customer']>;
  step: 1 | 2;
  typed: string;
  warningId: string;
  onStepChange: (step: 1 | 2) => void;
  onTypedChange: (typed: string) => void;
}

const PurgeSteps = ({ customer, step, typed, warningId, isSubmitting, error, onStepChange, onTypedChange, onConfirm, onCancel }: PurgeStepsProps) => {
  const fieldId = useId();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 1) {
      onStepChange(2);
      return;
    }
    if (isPurgeConfirmed(typed) && !isSubmitting) onConfirm();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <p id={warningId} className="flex items-start gap-2 rounded-lg bg-error-50 px-3 py-2 text-theme-sm font-medium text-error-700 dark:bg-error-500/10 dark:text-error-400">
        <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>Thao tác này KHÔNG THỂ HOÀN TÁC. Sau khi xóa vĩnh viễn, không khôi phục được khách này nữa.</span>
      </p>
      <div className="space-y-2 text-theme-sm text-gray-600 dark:text-gray-400">
        <p>
          Khách: <strong className="text-gray-800 dark:text-white/90">{customer.fullName}</strong> {hasPhone(customer.phoneMasked) ? `(${customer.phoneMasked})` : null}
        </p>
        <p>Các dữ liệu sau sẽ bị xóa hẳn:</p>
        <ul className="list-disc space-y-0.5 pl-5">
          {LOST_DATA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>Số điện thoại của khách sẽ được giải phóng và có thể dùng lại cho khách khác.</p>
      </div>

      {step === 2 && (
        <div>
          <label htmlFor={fieldId} className={FORM_LABEL_CLASS}>
            Gõ <strong>XOA</strong> hoặc <strong>XÓA</strong> để xác nhận xóa vĩnh viễn
          </label>
          <input id={fieldId} autoFocus value={typed} onChange={(event) => onTypedChange(event.target.value)} autoComplete="off" autoCapitalize="characters" className={MODAL_INPUT_CLASS} />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-1">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={BUTTON_OUTLINE_CLASS}>
          Huỷ
        </button>
        {step === 1 ? (
          <button type="submit" data-autofocus className={BUTTON_PRIMARY_CLASS}>
            Tôi hiểu, tiếp tục
          </button>
        ) : (
          <button type="submit" disabled={!isPurgeConfirmed(typed) || isSubmitting} className={DANGER_BUTTON_CLASS}>
            {isSubmitting ? 'Đang xóa…' : 'Xóa vĩnh viễn'}
          </button>
        )}
      </div>
    </form>
  );
};

export const PurgeCustomerDialog = ({ customer, isSubmitting, error, onConfirm, onCancel }: PurgeCustomerDialogProps) => {
  // Bước và chữ xác nhận nằm ở đây (không trong form) để biết đang ở bước 2: khi đó nhấp nền KHÔNG đóng hộp (Esc/Huỷ vẫn đóng).
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const warningId = useId();
  const customerId = customer?.id ?? null;
  useEffect(() => {
    setStep(1);
    setTyped('');
  }, [customerId]);

  return (
    <DialogFrame
      isOpen={customer !== null}
      title="Xóa vĩnh viễn khách?"
      role="alertdialog"
      describedById={warningId}
      isBackdropClosable={step === 1 && !isSubmitting}
      onClose={isSubmitting ? () => undefined : onCancel}
    >
      {customer && <PurgeSteps customer={customer} step={step} typed={typed} warningId={warningId} isSubmitting={isSubmitting} error={error} onStepChange={setStep} onTypedChange={setTyped} onConfirm={onConfirm} onCancel={onCancel} />}
    </DialogFrame>
  );
};
