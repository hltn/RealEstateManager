import { AlertCircle } from 'lucide-react';

interface FieldErrorProps {
  id: string;
  message?: string;
}

/** Dòng báo lỗi dưới ô nhập (mẫu Admin `mt-1 text-xs text-error-500`); gắn với input qua `aria-describedby={id}`. */
export const FieldError = ({ id, message }: FieldErrorProps) =>
  message ? (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1 text-xs text-error-500 dark:text-error-400">
      <AlertCircle size={14} aria-hidden="true" className="mt-px shrink-0" />
      <span>{message}</span>
    </p>
  ) : null;

/** Thuộc tính a11y cho ô nhập có thể lỗi. */
export const getFieldA11yProps = (errorId: string, message?: string) => ({
  'aria-invalid': message ? true : undefined,
  'aria-describedby': message ? errorId : undefined,
});
