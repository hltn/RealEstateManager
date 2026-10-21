import type { DayPeriod } from '@crm/types/crm';

export const TODAY_LABEL = 'Hôm nay';

const pad2 = (value: number): string => value.toString().padStart(2, '0');

/** Date -> "dd/MM" (định dạng ngày của nhật ký chăm sóc). */
export const formatDayMonth = (date: Date): string =>
  `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;

/** Date -> "HH:mm" (24h). */
export const formatTime24 = (date: Date): string =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/** Date -> ISO ngày "YYYY-MM-DD" theo giờ địa phương. */
export const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Mốc thời gian cho bản ghi mới: { date: "dd/MM", time: "HH:mm" }. */
export const getCurrentStamp = (now: Date = new Date()): { date: string; time: string } => ({
  date: formatDayMonth(now),
  time: formatTime24(now),
});

/**
 * Hiển thị ngày nhật ký: trả "Hôm nay" nếu trùng ngày hiện tại, ngược lại giữ nguyên.
 * Dữ liệu prototype có thể đã là "Hôm nay" -> giữ nguyên.
 */
export const formatCareLogDate = (date: string, now: Date = new Date()): string =>
  date === formatDayMonth(now) ? TODAY_LABEL : date;

/** Tách "HH:mm" -> { hours, minutes }. Trả null nếu sai định dạng. */
export const parseTime24 = (time: string): { hours: number; minutes: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
};

/** "14:30" -> "02:30 PM" (định dạng hiển thị của 2 prototype). */
export const formatTime12h = (time: string): string => {
  const parsed = parseTime24(time);
  if (!parsed) return time;
  const suffix = parsed.hours >= 12 ? 'PM' : 'AM';
  const hours12 = parsed.hours % 12 === 0 ? 12 : parsed.hours % 12;
  return `${pad2(hours12)}:${pad2(parsed.minutes)} ${suffix}`;
};

/** Buổi trong ngày theo giờ: trước 12:00 là sáng, còn lại là chiều. */
export const getDayPeriod = (time: string): DayPeriod => {
  const parsed = parseTime24(time);
  return parsed && parsed.hours < 12 ? 'morning' : 'afternoon';
};

const WEEKDAY_SHORT_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;

/** "2026-10-21" -> { dayOfWeek: "T4", dayNumber: 21 } (dùng cho dải lịch tuần của Mobile). */
export const getIsoDateParts = (isoDate: string): { dayOfWeek: string; dayNumber: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return { dayOfWeek: WEEKDAY_SHORT_LABELS[date.getDay()], dayNumber: date.getDate() };
};

/** "2026-10-21" -> "21/10/2026". */
export const formatIsoDateVi = (isoDate: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
};
