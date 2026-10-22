/**
 * Hàm thuần cho màn Lịch hẹn: tính tuần/tháng, lọc lịch theo ngày/khoảng, KPI.
 * Ngày lịch = khoá ngày giờ VN "YYYY-MM-DD" suy từ `startAt` (so sánh chuỗi = so sánh thời gian).
 */
import type { AppointmentView } from '@crm/api';
import { getAppointmentDateKey, getAppointmentPeriod } from '@crm/lib/appointmentAdapters';
import { getIsoDateParts, toIsoDate } from '@crm/lib/dateTime';
import type { AppointmentType, DayPeriod } from '@crm/types/crm';

type Appointment = AppointmentView;

const dateOf = (appointment: Appointment): string => getAppointmentDateKey(appointment);
const isDone = (appointment: Appointment): boolean => appointment.status === 'DONE';

const DAYS_PER_WEEK = 7;
/** Tiêu đề cột lịch (tuần bắt đầu thứ Hai). */
export const WEEKDAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;
/** Số lịch hẹn tối thiểu để 1 ngày được đánh dấu "cao điểm" (màu cam). */
export const PEAK_DAY_MIN_APPOINTMENTS = 4;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-21" -> Date (giờ địa phương), null nếu sai định dạng. */
export const parseIsoDate = (isoDate: string): Date | null => {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};

export const addDaysIso = (isoDate: string, days: number): string => {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
};

/** Vị trí trong tuần bắt đầu từ thứ Hai: T2 = 0 ... CN = 6. */
const getMondayBasedWeekday = (date: Date): number => (date.getDay() + 6) % DAYS_PER_WEEK;

/** 7 ngày ISO (thứ Hai -> Chủ nhật) của tuần chứa `isoDate`. */
export const getWeekDates = (isoDate: string): string[] => {
  const date = parseIsoDate(isoDate);
  if (!date) return [];
  const monday = addDaysIso(isoDate, -getMondayBasedWeekday(date));
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => addDaysIso(monday, index));
};

/** Ngày đầu và cuối của tháng chứa `isoDate`. */
export const getMonthRange = (isoDate: string): { startIso: string; endIso: string } => {
  const date = parseIsoDate(isoDate) ?? new Date();
  return {
    startIso: toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    endIso: toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
};

/** Ngày 1 của tháng cách tháng chứa `isoDate` `delta` tháng (điều hướng tháng trước/sau). */
export const shiftMonthIso = (isoDate: string, delta: number): string => {
  const date = parseIsoDate(isoDate) ?? new Date();
  return toIsoDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

export interface CalendarDay {
  isoDate: string;
  dayNumber: number;
  /** false = ngày của tháng trước/sau (hiển thị mờ). */
  isInMonth: boolean;
}

/**
 * Lưới lịch tháng đủ các tuần (thứ Hai đầu tuần), gồm ngày tràn của tháng trước/sau.
 * `monthIndex` 0-11 như Date.
 */
export const getMonthGrid = (year: number, monthIndex: number): CalendarDay[] => {
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const leadingDays = getMondayBasedWeekday(firstDay);
  const trailingDays = DAYS_PER_WEEK - 1 - getMondayBasedWeekday(lastDay);
  const totalCells = leadingDays + lastDay.getDate() + trailingDays;

  return Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(year, monthIndex, 1 - leadingDays + index);
    return { isoDate: toIsoDate(date), dayNumber: date.getDate(), isInMonth: date.getMonth() === monthIndex };
  });
};

const compareByDateTime = (first: Appointment, second: Appointment): number => first.startAt.localeCompare(second.startAt);

export const sortAppointmentsByDateTime = (appointments: Appointment[]): Appointment[] =>
  [...appointments].sort(compareByDateTime);

export const getAppointmentsOnDate = (appointments: Appointment[], isoDate: string): Appointment[] =>
  sortAppointmentsByDateTime(appointments.filter((appointment) => dateOf(appointment) === isoDate));

/** Lịch hẹn trong khoảng [startIso, endIso] (bao gồm 2 đầu). */
export const getAppointmentsInRange = (appointments: Appointment[], startIso: string, endIso: string): Appointment[] =>
  sortAppointmentsByDateTime(
    appointments.filter((appointment) => dateOf(appointment) >= startIso && dateOf(appointment) <= endIso),
  );

/** Lịch sắp tới: sau `todayIso`, chưa hoàn thành, (tuỳ chọn) không quá `untilIso`. */
export const getUpcomingAppointments = (appointments: Appointment[], todayIso: string, untilIso?: string): Appointment[] =>
  sortAppointmentsByDateTime(
    appointments.filter(
      (appointment) =>
        dateOf(appointment) > todayIso && !isDone(appointment) && (untilIso === undefined || dateOf(appointment) <= untilIso),
    ),
  );

export const groupAppointmentsByPeriod = (appointments: Appointment[]): Record<DayPeriod, Appointment[]> => {
  const groups: Record<DayPeriod, Appointment[]> = { morning: [], afternoon: [] };
  appointments.forEach((appointment) => groups[getAppointmentPeriod(appointment)].push(appointment));
  return groups;
};

/** Nhóm lịch theo ngày (giữ thứ tự xuất hiện) - dùng cho chế độ "Danh sách". */
export const groupAppointmentsByDate = (appointments: Appointment[]): { isoDate: string; appointments: Appointment[] }[] => {
  const groups: { isoDate: string; appointments: Appointment[] }[] = [];
  appointments.forEach((appointment) => {
    const isoDate = dateOf(appointment);
    const group = groups.find((item) => item.isoDate === isoDate);
    if (group) group.appointments.push(appointment);
    else groups.push({ isoDate, appointments: [appointment] });
  });
  return groups;
};

export const countAppointmentsByDate = (appointments: Appointment[]): Record<string, number> =>
  appointments.reduce<Record<string, number>>((counts, appointment) => {
    counts[dateOf(appointment)] = (counts[dateOf(appointment)] ?? 0) + 1;
    return counts;
  }, {});

export const isPeakDay = (appointmentCount: number): boolean => appointmentCount >= PEAK_DAY_MIN_APPOINTMENTS;

/** "2026-10-22" -> "T5, 22/10". */
export const formatShortWeekdayDate = (isoDate: string): string => {
  const parts = getIsoDateParts(isoDate);
  if (!parts) return isoDate;
  const month = isoDate.slice(5, 7);
  return `${parts.dayOfWeek}, ${parts.dayNumber.toString().padStart(2, '0')}/${month}`;
};

/** (2026, 9) -> "Tháng 10, 2026". */
export const formatMonthYearVi = (year: number, monthIndex: number): string => `Tháng ${monthIndex + 1}, ${year}`;

/** Nhãn ngắn dùng cho dòng tóm tắt "1 xem mẫu • 1 ký cọc • 1 gọi điện" (Admin KPI "Hôm nay"). */
const TYPE_SUMMARY_LABELS: Record<AppointmentType, string> = {
  SITE_VISIT: 'xem mẫu',
  DEPOSIT: 'ký cọc',
  MEETING: 'tư vấn',
  CALLBACK: 'gọi điện',
  OTHER: 'khác',
};

const TYPE_ORDER: AppointmentType[] = ['SITE_VISIT', 'DEPOSIT', 'MEETING', 'CALLBACK', 'OTHER'];

export const summarizeAppointmentTypes = (appointments: Appointment[]): string =>
  TYPE_ORDER.map((type) => {
    const count = appointments.filter((appointment) => appointment.type === type).length;
    return count > 0 ? `${count} ${TYPE_SUMMARY_LABELS[type]}` : '';
  })
    .filter(Boolean)
    .join(' • ');

const toPercent = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);

export interface AppointmentStats {
  total: number;
  todayCount: number;
  /** Lịch hôm nay chưa hoàn thành ("N sự kiện cần xử lý hôm nay"). */
  todayPendingCount: number;
  /** Lịch sau hôm nay đến hết Chủ nhật tuần này, chưa hoàn thành. */
  upcomingWeekCount: number;
  monthCompletedCount: number;
  monthCompletionPercent: number;
}

/** KPI của màn Lịch hẹn, tính theo ngày `todayIso`. */
export const getAppointmentStats = (appointments: Appointment[], todayIso: string): AppointmentStats => {
  const todayAppointments = appointments.filter((appointment) => dateOf(appointment) === todayIso);
  const weekDates = getWeekDates(todayIso);
  const upcomingWeek = getUpcomingAppointments(appointments, todayIso, weekDates[weekDates.length - 1]);
  const monthPrefix = todayIso.slice(0, 7);
  const monthAppointments = appointments.filter((appointment) => dateOf(appointment).startsWith(monthPrefix));
  const monthCompletedCount = monthAppointments.filter(isDone).length;

  return {
    total: appointments.length,
    todayCount: todayAppointments.length,
    todayPendingCount: todayAppointments.filter((appointment) => !isDone(appointment)).length,
    upcomingWeekCount: upcomingWeek.length,
    monthCompletedCount,
    monthCompletionPercent: toPercent(monthCompletedCount, monthAppointments.length),
  };
};
