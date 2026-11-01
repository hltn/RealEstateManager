/**
 * Lịch tháng thu nhỏ (web) - bố cục "Mini Calendar Card" của Admin Stitch AppointmentsView
 * (Admin App chỉ có DatePicker flatpickr dạng ô nhập, không có lịch nhúng), vẽ bằng token Admin.
 * Ngày bấm được (chọn ngày); nút tháng trước/sau chuyển tháng thật thay cho alert() của nguồn.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { formatIsoDateVi } from '@crm/lib/dateTime';
import { getMonthGrid, isPeakDay, parseIsoDate, WEEKDAY_HEADERS } from '../appointmentSchedule';
import { CAPTION_CLASS, CARD_CLASS, NAV_ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';

interface MiniMonthCalendarProps {
  selectedDate: string;
  todayIso: string;
  countsByDate: Record<string, number>;
  onSelectDate: (isoDate: string) => void;
}

/**
 * Lớp của 1 ô ngày, ưu tiên: ngày chọn (brand) > ngày tràn tháng (nhạt, không cam) > cao điểm (cam đậm)
 * > có lịch hẹn (cam nhạt) > thường; hôm nay thêm vòng brand.
 * Tương phản (WCAG AA >= 4.5): có lịch = warning-700/warning-100 4.78, hover warning-800/warning-200 5.78,
 * dark warning-300 trên warning-500/20 7.53 (hover /30: 6.13);
 * cao điểm = gray-900/warning-500 7.56 (chữ trắng trên warning-500 chỉ 2.4 nên không dùng).
 */
const getDayClass = (isSelected: boolean, isInMonth: boolean, count: number, isToday: boolean): string => {
  if (isSelected) return 'bg-brand-500 font-semibold text-white';
  const todayRing = isToday ? ' ring-1 ring-brand-300 dark:ring-brand-500/50' : '';
  if (!isInMonth) return `text-gray-300 hover:bg-gray-50 dark:text-gray-600 dark:hover:bg-white/[0.03]${todayRing}`;
  if (isPeakDay(count)) {
    return `bg-warning-500 font-bold text-gray-900 hover:bg-warning-400${todayRing}`;
  }
  if (count > 0) {
    return `bg-warning-100 font-semibold text-warning-700 hover:bg-warning-200 hover:text-warning-800 dark:bg-warning-500/20 dark:text-warning-300 dark:hover:bg-warning-500/30 dark:hover:text-warning-300${todayRing}`;
  }
  return `text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5${todayRing}`;
};

export const MiniMonthCalendar = ({ selectedDate, todayIso, countsByDate, onSelectDate }: MiniMonthCalendarProps) => {
  // Lệch tháng so với tháng của ngày đang chọn -> chọn ngày mới tự đưa lịch về đúng tháng.
  const [monthOffset, setMonthOffset] = useState(0);
  const anchor = parseIsoDate(selectedDate) ?? new Date();
  const visibleMonth = new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset, 1);
  const year = visibleMonth.getFullYear();
  const monthIndex = visibleMonth.getMonth();
  const days = getMonthGrid(year, monthIndex);

  const handleSelect = (isoDate: string) => {
    setMonthOffset(0);
    onSelectDate(isoDate);
  };

  return (
    <div className={`${CARD_CLASS} p-5`}>
      <div className="mb-4 flex items-center justify-between">
        <span className={CAPTION_CLASS}>
          Lịch tháng {monthIndex + 1}/{year}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Tháng trước" onClick={() => setMonthOffset((offset) => offset - 1)} className={NAV_ICON_BUTTON_CLASS}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Tháng sau" onClick={() => setMonthOffset((offset) => offset + 1)} className={NAV_ICON_BUTTON_CLASS}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-theme-xs">
        {WEEKDAY_HEADERS.map((label) => (
          <span key={label} className="py-1 font-medium text-gray-400 dark:text-gray-500">
            {label}
          </span>
        ))}
        {days.map((day) => {
          const isSelected = day.isoDate === selectedDate;
          const count = countsByDate[day.isoDate] ?? 0;
          return (
            <button
              key={day.isoDate}
              type="button"
              aria-pressed={isSelected}
              aria-label={`Chọn ngày ${formatIsoDateVi(day.isoDate)}${count > 0 ? `, có ${count} lịch hẹn` : ''}`}
              onClick={() => handleSelect(day.isoDate)}
              className={`relative rounded-lg py-1.5 transition-colors ${getDayClass(isSelected, day.isInMonth, count, day.isoDate === todayIso)}`}
            >
              {day.dayNumber}
              {isSelected && count > 0 && (
                <span data-testid="selected-has-appointments" aria-hidden="true" className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-warning-400" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-theme-xs text-gray-500 dark:border-white/[0.05] dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand-500" /> Ngày chọn
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warning-100 ring-1 ring-warning-300 dark:bg-warning-500/20 dark:ring-warning-500/40" /> Có lịch hẹn
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warning-500" /> Ngày cao điểm
        </span>
      </div>
    </div>
  );
};
