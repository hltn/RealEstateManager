/** Loại lịch hẹn (tài liệu 04 mục 3.5). `DEPOSIT_CONTRACT` hiển thị "Ký cọc / HĐMB" (quyết định #6). */
export enum AppointmentType {
  SITE_VISIT = 'SITE_VISIT',
  MEETING = 'MEETING',
  DEPOSIT_CONTRACT = 'DEPOSIT_CONTRACT',
  CALLBACK = 'CALLBACK',
  OTHER = 'OTHER',
}

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  DONE = 'DONE',
  CANCELED = 'CANCELED',
}

/** Nhãn tiếng Việt dùng trong thông báo và nhật ký tự sinh. */
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  [AppointmentType.SITE_VISIT]: 'Xem nhà mẫu',
  [AppointmentType.MEETING]: 'Gặp tư vấn',
  [AppointmentType.DEPOSIT_CONTRACT]: 'Ký cọc / HĐMB',
  [AppointmentType.CALLBACK]: 'Gọi lại theo hẹn',
  [AppointmentType.OTHER]: 'Lịch hẹn',
};

export const APPOINTMENT_TITLE_MAX_LENGTH = 200;
export const APPOINTMENT_LOCATION_MAX_LENGTH = 300;
export const APPOINTMENT_NOTE_MAX_LENGTH = 2000;
export const APPOINTMENT_OUTCOME_MAX_LENGTH = 2000;

/** Một lịch hẹn không dài quá 24 giờ (đa số là vài giờ; chặn nhập nhầm năm/ngày). */
export const APPOINTMENT_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
/** Cho phép lệch đồng hồ giữa máy khách và máy chủ khi kiểm "không hẹn vào quá khứ". */
export const APPOINTMENT_PAST_TOLERANCE_MS = 5 * 60 * 1000;
/** Tối đa 5 mốc nhắc, mỗi mốc trước tối đa 7 ngày. */
export const APPOINTMENT_MAX_REMINDERS = 5;
export const APPOINTMENT_MAX_REMIND_MINUTES = 7 * 24 * 60;
/** Khoảng xem lịch tối đa 62 ngày (tài liệu 05 mục 2.9). */
export const APPOINTMENT_RANGE_MAX_DAYS = 62;
