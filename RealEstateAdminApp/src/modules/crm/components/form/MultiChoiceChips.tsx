import type { ReactNode } from 'react';
import { FORM_LABEL_CLASS, OPTION_ACTIVE_CLASS, OPTION_IDLE_CLASS } from '@crm/lib/uiClasses';
import { toggleItem } from '../../screens/CreateCustomer/customerFormRules';

export interface MultiChoiceOption {
  value: string;
  label: string;
}

interface MultiChoiceChipsProps {
  legend: ReactNode;
  options: readonly MultiChoiceOption[];
  /** Giá trị đang chọn, GIỮ THỨ TỰ chọn (phần tử đầu = "chính" với nhóm). */
  values: readonly string[];
  onChange: (values: string[]) => void;
  hint?: ReactNode;
  /** Hiện khi `options` rỗng. */
  emptyMessage?: string;
  isRequired?: boolean;
}

/**
 * Nhóm chip chọn NHIỀU giá trị: checkbox thật (`sr-only`) bọc trong `<label>` → bàn phím + trình đọc màn hình hoạt động.
 * Bật thêm thì nối vào cuối, nên thứ tự chọn được giữ (dùng cho "nhóm chính" = nhóm chọn đầu tiên).
 */
export const MultiChoiceChips = ({ legend, options, values, onChange, hint, emptyMessage = 'Chưa có lựa chọn nào.', isRequired = false }: MultiChoiceChipsProps) => (
  <fieldset className="min-w-0">
    <legend className={FORM_LABEL_CLASS}>
      {legend}
      {isRequired && <span className="ml-0.5 text-error-500">*</span>}
    </legend>
    {options.length === 0 ? (
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{emptyMessage}</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = values.includes(option.value);
          return (
            <label
              key={option.value}
              className={`inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 ${isSelected ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS}`}
            >
              <input type="checkbox" className="sr-only" checked={isSelected} onChange={() => onChange(toggleItem(values, option.value))} />
              {option.label}
            </label>
          );
        })}
      </div>
    )}
    {hint && <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>}
  </fieldset>
);
