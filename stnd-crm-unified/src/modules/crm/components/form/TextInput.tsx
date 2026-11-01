import type { InputHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { INPUT_ICON_CLASS, getInputClass } from '@crm/lib/uiClasses';

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  hasError?: boolean;
  /** Phần tử đặt sát mép phải trong ô (đơn vị "tỷ", icon trạng thái...). */
  rightAddon?: ReactNode;
  wrapperClassName?: string;
}

/** Ô nhập chuẩn Admin, có icon lucide bên trái (mẫu "Ô tìm có icon") và phần phụ bên phải. */
export const TextInput = ({
  icon: Icon,
  hasError = false,
  rightAddon,
  className,
  wrapperClassName,
  ...inputProps
}: TextInputProps) => (
  <div className={`relative ${wrapperClassName ?? ''}`}>
    {Icon && <Icon size={18} aria-hidden="true" className={INPUT_ICON_CLASS} />}
    <input
      {...inputProps}
      className={`${getInputClass({ hasError, hasLeftIcon: Boolean(Icon), hasRightAddon: Boolean(rightAddon) })} ${
        className ?? ''
      }`}
    />
    {rightAddon && (
      <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center text-xs text-gray-400 dark:text-gray-500">
        {rightAddon}
      </span>
    )}
  </div>
);
