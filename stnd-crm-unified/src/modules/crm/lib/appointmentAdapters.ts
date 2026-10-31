/**
 * Hàm thuần hiển thị lịch hẹn (mã loại theo tài liệu 04 §3.5: SITE_VISIT / MEETING / DEPOSIT / CALLBACK / OTHER).
 */
import type { AppointmentType, DayPeriod } from '@crm/types/crm';
import { getDayPeriod, toVnDateKey, toVnTime } from './dateTime';

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  SITE_VISIT: 'Xem nhà mẫu',
  DEPOSIT_CONTRACT: 'Ký cọc / HĐMB',
  MEETING: 'Gặp tư vấn',
  CALLBACK: 'Nhắc gọi lại',
  OTHER: 'Khác',
};

/**
 * Dung sai giờ hẹn ở quá khứ (ms): backend chấp nhận `startAt` sớm hơn "bây giờ" tối đa 5 phút
 * (`APPOINTMENT_PAST_TOLERANCE_MS` ở backend). Giữ khớp để form tạo lịch và khối "Lịch hẹn sắp tới" cùng quy tắc.
 */
export const APPOINTMENT_PAST_TOLERANCE_MS = 5 * 60 * 1000;

/** Khoá ngày VN của lịch hẹn ("YYYY-MM-DD"). */
export const getAppointmentDateKey = (appointment: { startAt: string }): string => toVnDateKey(appointment.startAt);

/** Giờ VN của lịch hẹn ("HH:mm"). */
export const getAppointmentTime = (appointment: { startAt: string }): string => toVnTime(appointment.startAt);

/** Buổi sáng/chiều (giờ VN). */
export const getAppointmentPeriod = (appointment: { startAt: string }): DayPeriod => getDayPeriod(appointment.startAt);

/** Tiêu đề hiển thị: "09:30 - Xem nhà mẫu Q'Terra"; tiêu đề trống -> nhãn loại. */
export const getAppointmentTitle = (appointment: { title: string; startAt: string; type: AppointmentType }): string =>
  `${getAppointmentTime(appointment)} - ${appointment.title.trim() || APPOINTMENT_TYPE_LABELS[appointment.type]}`;

/** Các mốc nhắc trước (phút) và nhãn. */
export const REMINDER_OPTIONS: readonly { minutes: number; label: string }[] = [
  { minutes: 15, label: 'Trước 15 phút' },
  { minutes: 30, label: 'Trước 30 phút' },
  { minutes: 60, label: 'Trước 1 tiếng' },
  { minutes: 120, label: 'Trước 2 tiếng' },
  { minutes: 1440, label: 'Trước 1 ngày' },
];
