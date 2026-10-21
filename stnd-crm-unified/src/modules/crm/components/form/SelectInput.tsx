import type { SelectHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { INPUT_ICON_CLASS, getSelectClass } from '@crm/lib/uiClasses';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly (string | SelectOption)[];
  icon?: LucideIcon;
  hasError?: boolean;
  /** Thêm lựa chọn rỗng đầu danh sách (giá trị hiện tại có thể chưa đặt, vd khách mới tạo). */
  emptyLabel?: string;
}

const toOption = (option: string | SelectOption): SelectOption =>
  typeof option === 'string' ? { value: option, label: option } : option;

/** `<select>` gốc theo mẫu Admin (`UserManagementScreen.tsx:420`), có icon lucide bên trái. */
export const SelectInput = ({ options, icon: Icon, hasError = false, emptyLabel, className, ...selectProps }: SelectInputProps) => (
  <div className="relative">
    {Icon && <Icon size={18} aria-hidden="true" className={`${INPUT_ICON_CLASS} z-10`} />}
    <select {...selectProps} className={`${getSelectClass({ hasError, hasLeftIcon: Boolean(Icon) })} ${className ?? ''}`}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map(toOption).map((option) => (
        <option key={option.value || '__empty'} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);
