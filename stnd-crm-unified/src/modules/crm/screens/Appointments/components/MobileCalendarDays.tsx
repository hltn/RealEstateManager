/**
 * Ô chọn ngày trên app - bố cục "7-Day Strip" của Mobile Stitch AppointmentsView (Admin App không có),
 * vẽ bằng token Admin + cặp `dark:`. Chế độ "month" dùng lại kiểu ô của dải tuần cho cả tháng (nguồn chưa vẽ).
 */
import { formatIsoDateVi, getIsoDateParts } from '@crm/lib/dateTime';
import { getMonthGrid, getWeekDates, parseIsoDate, WEEKDAY_HEADERS } from '../appointmentSchedule';

interface MobileCalendarDaysProps {
  mode: 'week' | 'month';
  selectedDate: string;
  todayIso: string;
  countsByDate: Record<string, number>;
  onSelectDate: (isoDate: string) => void;
}

interface DayButtonProps {
  isoDate: string;
  isSelected: boolean;
  isToday: boolean;
  isMuted?: boolean;
  count: number;
  shouldShowWeekday: boolean;
  onSelectDate: (isoDate: string) => void;
}

const DayButton = ({ isoDate, isSelected, isToday, isMuted = false, count, shouldShowWeekday, onSelectDate }: DayButtonProps) => {
  const parts = getIsoDateParts(isoDate);
  const dayNumberClass = isSelected
    ? 'h-7 w-7 rounded-full bg-white text-brand-600 dark:bg-gray-900 dark:text-brand-400'
    : `text-gray-700 dark:text-gray-300 ${isToday ? 'h-7 w-7 rounded-full ring-1 ring-brand-300 dark:ring-brand-500/50' : ''}`;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      aria-label={`${formatIsoDateVi(isoDate)}: ${count} lịch hẹn`}
      onClick={() => onSelectDate(isoDate)}
      className={`flex min-h-11 flex-col items-center rounded-xl px-0.5 py-1.5 transition-colors ${
        isSelected ? 'bg-brand-500 text-white' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'
      } ${isMuted && !isSelected ? 'opacity-40' : ''}`}
    >
      {shouldShowWeekday && (
        <span className={`text-theme-xs ${isSelected ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'}`}>{parts?.dayOfWeek}</span>
      )}
      <span className={`${shouldShowWeekday ? 'mt-1' : ''} flex items-center justify-center text-sm font-semibold ${dayNumberClass}`}>
        {parts?.dayNumber}
      </span>
      <span className="mt-1 flex h-3.5 items-center">
        {isSelected ? (
          <span className="whitespace-nowrap text-[10px] font-semibold text-white">{count} hẹn</span>
        ) : (
          <span aria-hidden="true" className={`block h-1.5 w-1.5 rounded-full ${count > 0 ? 'bg-brand-400' : 'bg-transparent'}`} />
        )}
      </span>
    </button>
  );
};

export const MobileCalendarDays = ({ mode, selectedDate, todayIso, countsByDate, onSelectDate }: MobileCalendarDaysProps) => {
  if (mode === 'week') {
    return (
      <div className="grid grid-cols-7 gap-1">
        {getWeekDates(selectedDate).map((isoDate) => (
          <DayButton
            key={isoDate}
            isoDate={isoDate}
            isSelected={isoDate === selectedDate}
            isToday={isoDate === todayIso}
            count={countsByDate[isoDate] ?? 0}
            shouldShowWeekday
            onSelectDate={onSelectDate}
          />
        ))}
      </div>
    );
  }

  const anchor = parseIsoDate(selectedDate) ?? new Date();
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAY_HEADERS.map((label) => (
        <span key={label} className="text-center text-theme-xs text-gray-400 dark:text-gray-500">
          {label}
        </span>
      ))}
      {getMonthGrid(anchor.getFullYear(), anchor.getMonth()).map((day) => (
        <DayButton
          key={day.isoDate}
          isoDate={day.isoDate}
          isSelected={day.isoDate === selectedDate}
          isToday={day.isoDate === todayIso}
          isMuted={!day.isInMonth}
          count={countsByDate[day.isoDate] ?? 0}
          shouldShowWeekday={false}
          onSelectDate={onSelectDate}
        />
      ))}
    </div>
  );
};
