import type { ReactNode } from 'react';
import { FieldError } from './FieldError';
import { FORM_HINT_CLASS, FORM_LABEL_CLASS, FORM_LABEL_TEXT_CLASS } from '@crm/lib/uiClasses';

interface FormFieldProps {
  /** id của ô nhập (label `htmlFor`); lỗi dùng id `${inputId}-error`. */
  inputId: string;
  label: ReactNode;
  isRequired?: boolean;
  error?: string;
  hint?: ReactNode;
  /**
   * Ô chỉ-đọc không có phần tử nhập (vd thẻ khách bị khóa): nhãn vẽ bằng `<span>` có id (`getLabelId`) để `aria-labelledby` trỏ vào,
   * tránh `<label for>` trỏ vào phần tử không gắn nhãn được.
   */
  isLabelStatic?: boolean;
  /** Nội dung phụ bên phải nhãn (chip trạng thái, "Mã hóa bảo mật"...). */
  labelAddon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Nhãn + ô nhập + lỗi/gợi ý theo mẫu form Admin (`UserManagementScreen.tsx:374-383`). */
export const FormField = ({ inputId, label, isRequired = false, error, hint, isLabelStatic = false, labelAddon, className, children }: FormFieldProps) => (
  <div className={`min-w-0 ${className ?? ''}`}>
    <div className={labelAddon ? 'mb-1.5 flex flex-wrap items-center justify-between gap-2' : undefined}>
      {isLabelStatic ? (
        <span id={getLabelId(inputId)} className={labelAddon ? FORM_LABEL_TEXT_CLASS : FORM_LABEL_CLASS}>
          {label}
          {isRequired && <span className="ml-0.5 text-error-500 dark:text-error-400">*</span>}
        </span>
      ) : (
        <label htmlFor={inputId} className={labelAddon ? FORM_LABEL_TEXT_CLASS : FORM_LABEL_CLASS}>
          {label}
          {isRequired && <span className="ml-0.5 text-error-500 dark:text-error-400">*</span>}
        </label>
      )}
      {labelAddon}
    </div>
    {children}
    <FieldError id={`${inputId}-error`} message={error} />
    {!error && hint && (
      <p id={getHintId(inputId)} className={FORM_HINT_CLASS}>
        {hint}
      </p>
    )}
  </div>
);

/** id lỗi tương ứng của `FormField` (dùng với `getFieldA11yProps`). */
export const getErrorId = (inputId: string) => `${inputId}-error`;

/** id nhãn (khi `isLabelStatic`) và id dòng gợi ý của `FormField` (dùng với `aria-labelledby` / `aria-describedby`). */
export const getLabelId = (inputId: string) => `${inputId}-label`;
export const getHintId = (inputId: string) => `${inputId}-hint`;
