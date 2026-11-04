/**
 * Dải 7 ngày của tuần (web) - bố cục "7-Day Ribbon" của Admin Stitch AppointmentsView
 * (Admin App không có), vẽ bằng token/cặp `dark:` của Admin. Nút trước/sau chuyển tuần.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatIsoDateVi, getIsoDateParts } from '@crm/lib/dateTime';
import { isPeakDay } from '../appointmentSchedule';
import { CAPTION_CLASS, CARD_CLASS, NAV_ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';

interface WeekRibbonProps {
  weekDates: string[];
  selectedDate: string;
  todayIso: string;
  countsByDate: Record<string, number>;
  todayPendingCount: number;
  onSelectDate: (isoDate: string) => void;
  onShiftWeek: (direction: -1 | 1) => void;
}

const getCountBadgeClass = (isSelected: boolean, count: number): string => {
  if (isSelected) return 'bg-white text-brand-600 dark:bg-gray-900 dark:text-brand-400';
  if (isPeakDay(count)) return 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500';
  if (count > 0) return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  return 'text-gray-400 dark:text-gray-500';
};

export const WeekRibbon = ({
  weekDates,
  selectedDate,
  todayIso,
  countsByDate,
  todayPendingCount,
  onSelectDate,
  onShiftWeek,
}: WeekRibbonProps) => (
  <div className={`${CARD_CLASS} p-4`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Tuần trước" onClick={() => onShiftWeek(-1)} className={NAV_ICON_BUTTON_CLASS}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className={CAPTION_CLASS}>
          Tuần {formatIsoDateVi(weekDates[0] ?? selectedDate).slice(0, 5)} – {formatIsoDateVi(weekDates[6] ?? selectedDate).slice(0, 5)}
        </span>
        <button type="button" aria-label="Tuần sau" onClick={() => onShiftWeek(1)} className={NAV_ICON_BUTTON_CLASS}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <span className="text-theme-xs font-medium text-brand-600 dark:text-brand-400">
        {todayPendingCount} sự kiện cần xử lý hôm nay
      </span>
    </div>

    <div className="grid grid-cols-7 gap-1.5 pt-2 lg:gap-2">
      {weekDates.map((isoDate) => {
        const parts = getIsoDateParts(isoDate);
        const count = countsByDate[isoDate] ?? 0;
        const isSelected = isoDate === selectedDate;
        const isToday = isoDate === todayIso;
        return (
          <button
            key={isoDate}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${formatIsoDateVi(isoDate)}: ${count} lịch hẹn`}
            onClick={() => onSelectDate(isoDate)}
            className={`relative flex min-w-0 flex-col items-center justify-center rounded-xl border p-2 text-center transition-colors lg:p-2.5 ${
              isSelected
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-white/[0.03]'
            }`}
          >
            {isToday && (
              <span
                className={`absolute -top-2 whitespace-nowrap rounded-full px-1.5 text-[10px] font-semibold ${
                  isSelected
                    ? 'bg-white text-brand-600 ring-1 ring-brand-500 dark:bg-gray-900 dark:text-brand-400'
                    : 'bg-brand-500 text-white'
                }`}
              >
                Hôm nay
              </span>
            )}
            <span className={`text-theme-xs font-medium ${isSelected ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
              {parts?.dayOfWeek}
            </span>
            <span className={`mt-0.5 text-lg font-semibold ${isSelected ? 'text-white' : 'text-gray-800 dark:text-white/90'}`}>
              {parts?.dayNumber}
            </span>
            <span
              className={`mt-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium lg:px-2 ${getCountBadgeClass(isSelected, count)}`}
            >
              {count} hẹn
            </span>
          </button>
        );
      })}
    </div>
  </div>
);
