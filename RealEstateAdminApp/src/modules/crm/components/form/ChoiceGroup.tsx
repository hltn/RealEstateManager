import { useId, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { BRAND_SOFT_CHIP_CLASS, FORM_LABEL_CLASS, OPTION_ACTIVE_CLASS, OPTION_IDLE_CLASS } from '@crm/lib/uiClasses';

export interface ChoiceOption<TValue extends string> {
  value: TValue;
  label: string;
  description?: string;
  icon?: LucideIcon;
  /** Lớp màu chấm trạng thái (vd `bg-success-500`). */
  dotClass?: string;
}

interface ChoiceGroupProps<TValue extends string> {
  legend: ReactNode;
  options: readonly ChoiceOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  /**
   * - `button`: nhóm nút một hàng (h-11), dùng cho lựa chọn ngắn.
   * - `card`: thẻ chọn kiểu radio có icon + mô tả (Admin chưa có — vẽ theo Stitch bằng token Admin).
   */
  appearance?: 'button' | 'card';
  /** Lớp lưới, vd `grid-cols-1 sm:grid-cols-3`. */
  gridClass?: string;
  isRequired?: boolean;
}

/**
 * Nhóm chọn MỘT giá trị: radio thật (`sr-only`) bọc trong `<label>` → bàn phím (mũi tên) + trình đọc màn hình hoạt động.
 * Viền focus hiện qua `has-[:focus-visible]` (Tailwind v4).
 */
export const ChoiceGroup = <TValue extends string>({
  legend,
  options,
  value,
  onChange,
  appearance = 'button',
  gridClass = 'grid-cols-2 sm:grid-cols-3',
  isRequired = false,
}: ChoiceGroupProps<TValue>) => {
  const name = useId();
  const isCard = appearance === 'card';

  return (
    <fieldset className="min-w-0">
      <legend className={FORM_LABEL_CLASS}>
        {legend}
        {isRequired && <span className="ml-0.5 text-error-500">*</span>}
      </legend>
      <div className={`grid gap-2.5 ${gridClass}`}>
        {options.map((option) => {
          const isActive = option.value === value;
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className={`relative flex cursor-pointer border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 ${
                isActive ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS
              } ${
                isCard
                  ? 'flex-col gap-1 rounded-xl p-3.5'
                  : 'min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-sm font-medium'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={isActive}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {isCard ? (
                <>
                  <span className="flex items-center justify-between gap-2">
                    {Icon ? (
                      <Icon
                        size={20}
                        aria-hidden="true"
                        className={isActive ? 'text-brand-500 dark:text-brand-400' : 'text-gray-400 dark:text-gray-500'}
                      />
                    ) : (
                      <span />
                    )}
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                        isActive ? 'border-brand-500' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {isActive && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </span>
                  </span>
                  <span className={`text-sm font-semibold ${isActive ? '' : 'text-gray-800 dark:text-white/90'}`}>
                    {option.label}
                  </span>
                  {option.description && (
                    <span className={`text-xs ${isActive ? 'opacity-90' : 'text-gray-500 dark:text-gray-400'}`}>
                      {option.description}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {option.dotClass && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${option.dotClass}`} />}
                  {Icon && <Icon size={16} aria-hidden="true" className="shrink-0" />}
                  <span>{option.label}</span>
                </>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

interface ChipMultiSelectProps {
  legend: ReactNode;
  /** Chuỗi (giá trị = nhãn) hoặc `{ value, label }` (vd chọn dự án theo id). */
  options: readonly (string | { value: string; label: string })[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  icon?: LucideIcon;
  isRequired?: boolean;
  error?: ReactNode;
}

/** Chip chọn nhiều (Admin chưa có): checkbox thật `sr-only`, chip đang chọn dùng mẫu "nút nhạt cùng tông brand". */
export const ChipMultiSelect = ({ legend, options, selected, onToggle, icon: Icon, isRequired = false, error }: ChipMultiSelectProps) => (
  <fieldset className="min-w-0">
    <legend className={FORM_LABEL_CLASS}>
      {legend}
      {isRequired && <span className="ml-0.5 text-error-500">*</span>}
    </legend>
    <div className="flex flex-wrap gap-2">
      {options.map((rawOption) => {
        const option = typeof rawOption === 'string' ? { value: rawOption, label: rawOption } : rawOption;
        const isSelected = selected.includes(option.value);
        return (
          <label
            key={option.value}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 ${
              isSelected ? BRAND_SOFT_CHIP_CLASS : `border ${OPTION_IDLE_CLASS}`
            }`}
          >
            <input type="checkbox" checked={isSelected} onChange={() => onToggle(option.value)} className="sr-only" />
            {isSelected ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              Icon && <Icon size={14} aria-hidden="true" className="text-gray-400 dark:text-gray-500" />
            )}
            {option.label}
          </label>
        );
      })}
    </div>
    {error}
  </fieldset>
);
