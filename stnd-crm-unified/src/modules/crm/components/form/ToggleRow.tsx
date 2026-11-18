import { useId } from 'react';
import { ToggleSwitch } from './ToggleSwitch';

interface ToggleRowProps {
  title: string;
  description?: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  /** Lớp bổ sung cho hàng (vd đường kẻ ngăn trên). */
  className?: string;
}

/** Hàng "nhãn + mô tả bên trái, công tắc gạt `role="switch"` bên phải" dùng chung cho các tuỳ chọn bật/tắt trong form. Công tắc trỏ `aria-describedby` tới đoạn mô tả. */
export const ToggleRow = ({ title, description, isChecked, onChange, className = '' }: ToggleRowProps) => {
  const descriptionId = useId();

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
        {description && (
          <p id={descriptionId} className="text-theme-xs text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
      </div>
      <ToggleSwitch isChecked={isChecked} onChange={onChange} label={title} size="sm" describedBy={description ? descriptionId : undefined} />
    </div>
  );
};
