/**
 * Thẻ chọn loại lịch hẹn kiểu radio — Admin App không có, làm theo bố cục Stitch
 * (desktop: thẻ có mô tả; mobile: thẻ gọn 2 cột) bằng token/bo góc/cặp `dark:` của Admin.
 * Dùng <input type="radio"> thật (ẩn) để bàn phím + trình đọc màn hình hoạt động đúng.
 */
import { Check } from 'lucide-react';
import type { AppointmentType } from '@crm/types/crm';
import { APPOINTMENT_TYPE_STYLES } from '../../Appointments/appointmentTypeStyles';
import { CHIP_SMALL_CLASS } from '@crm/lib/uiClasses';
import { APPOINTMENT_TYPE_OPTIONS } from '../createAppointmentForm';

interface AppointmentTypePickerProps {
  /** id của radio đầu tiên (focus khi lỗi). */
  id: string;
  value: AppointmentType;
  onChange: (type: AppointmentType) => void;
  variant: 'detailed' | 'compact';
}

const RADIO_NAME = 'appointment-type';

export const AppointmentTypePicker = ({ id, value, onChange, variant }: AppointmentTypePickerProps) => {
  const isCompact = variant === 'compact';
  return (
    <fieldset>
      <legend className="sr-only">Loại cuộc hẹn</legend>
      <div className={`grid grid-cols-2 ${isCompact ? 'gap-2.5' : 'gap-4'}`}>
        {APPOINTMENT_TYPE_OPTIONS.map((option, index) => {
          const isSelected = value === option.type;
          const { icon: Icon, iconBoxClass } = APPOINTMENT_TYPE_STYLES[option.type];
          const isOther = option.type === 'OTHER';
          return (
            <label
              key={option.type}
              className={`relative flex cursor-pointer select-none rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${
                isCompact ? 'items-center' : 'flex-col p-4'
              } ${isOther ? 'col-span-2' : isCompact ? '' : 'col-span-2 sm:col-span-1'} ${
                isSelected
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:border-brand-500 dark:bg-brand-500/10'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-white/[0.03]'
              }`}
            >
              <input
                id={index === 0 ? id : undefined}
                type="radio"
                name={RADIO_NAME}
                value={option.type}
                checked={isSelected}
                onChange={() => onChange(option.type)}
                className="sr-only"
              />
              <div className={`flex ${isCompact ? 'items-center gap-2.5' : 'items-start justify-between gap-2'}`}>
                <span className={`flex shrink-0 items-center justify-center rounded-lg ${isCompact ? 'h-8 w-8' : 'h-10 w-10'} ${iconBoxClass}`}>
                  <Icon size={isCompact ? 16 : 20} aria-hidden="true" />
                </span>
                {isCompact ? (
                  <span className="min-w-0 pr-5">
                    <span className="block text-xs font-medium leading-tight text-gray-800 dark:text-white/90">{option.shortTitle}</span>
                    <span
                      className={`mt-0.5 block text-[11px] leading-tight ${
                        option.isHighPriority ? 'font-semibold text-warning-700 dark:text-warning-500' : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {option.shortDescription}
                    </span>
                  </span>
                ) : (
                  option.isHighPriority &&
                  !isSelected && (
                    <span className={`${CHIP_SMALL_CLASS} bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500`}>
                      Ưu tiên cao
                    </span>
                  )
                )}
              </div>
              {!isCompact && (
                <>
                  <span className="mt-3 text-sm font-semibold text-gray-800 dark:text-white/90">{option.title}</span>
                  <span className="mt-1 text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">{option.description}</span>
                </>
              )}
              {isSelected && (
                <span
                  aria-hidden="true"
                  className={`absolute flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white ${
                    isCompact ? 'right-2 top-2' : 'right-4 top-4'
                  }`}
                >
                  <Check size={14} strokeWidth={3} />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};
