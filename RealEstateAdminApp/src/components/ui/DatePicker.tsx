import { forwardRef } from 'react';
import Flatpickr from 'react-flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { Calendar } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export interface DatePickerProps {
  value?: string | Date | string[] | Date[];
  onChange?: (dateStr: string) => void;
  placeholder?: string;
  className?: string; 
  inputClassName?: string;
  mode?: "single" | "multiple" | "range";
}

export const DatePicker = forwardRef<any, DatePickerProps>(
  ({ value, onChange, placeholder = "Select date", className = "", inputClassName = "", mode = "single" }, ref) => {
    return (
      <div className={`flatpickr-wrapper relative ${className}`}>
        <Flatpickr
          ref={ref}
          value={value as any}
          onChange={(_, dateStr) => {
            if (onChange) {
              onChange(dateStr);
            }
          }}
          options={{
            dateFormat: 'Y-m-d',
            mode: mode,
          }}
          placeholder={placeholder}
          className={twMerge(
            "dark:bg-dark-900 datepickerTwo shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 dark:focus:border-brand-800 w-full appearance-none rounded-lg border border-gray-300 bg-transparent px-4 pr-11 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 flatpickr-input",
            inputClassName || "h-11 py-2.5"
          )}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-500 dark:text-gray-400">
          <Calendar size={18} strokeWidth={2} />
        </span>
      </div>
    );
  }
);

DatePicker.displayName = "DatePicker";
