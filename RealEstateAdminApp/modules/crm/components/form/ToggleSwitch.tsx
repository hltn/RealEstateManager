interface ToggleSwitchProps {
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  /** Nhãn cho trình đọc màn hình (dùng khi không có `labelledBy`). */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /**
   * - `md` (mặc định): công tắc lớn `CronjobScreen.tsx:79-84` (bật `bg-success-500`, núm 24px).
   * - `sm`: công tắc nhỏ `AiConfigScreen.tsx:307-317` (`h-6 w-11`, bật `bg-brand-500`) cho hàng tuỳ chọn gọn.
   */
  size?: 'md' | 'sm';
}

const SIZE_CLASS = {
  md: { track: 'h-8 w-14 p-1', thumb: 'h-6 w-6', on: 'bg-success-500', shift: 'translate-x-6' },
  sm: { track: 'h-6 w-11 p-1', thumb: 'h-4 w-4', on: 'bg-brand-500', shift: 'translate-x-5' },
} as const;

/** Công tắc `role="switch"` theo 2 mẫu công tắc của Admin; tắt luôn `bg-gray-300 dark:bg-gray-600`. */
export const ToggleSwitch = ({ isChecked, onChange, label, labelledBy, describedBy, size = 'md' }: ToggleSwitchProps) => {
  const sizeClass = SIZE_CLASS[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={() => onChange(!isChecked)}
      className={`relative shrink-0 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${sizeClass.track} ${
        isChecked ? sizeClass.on : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`block rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${sizeClass.thumb} ${
          isChecked ? sizeClass.shift : 'translate-x-0'
        }`}
      />
    </button>
  );
};
