/** Loại nhắc việc (tài liệu 04 mục 3.5 `reminders`). */
export enum ReminderType {
  APPOINTMENT = 'APPOINTMENT',
  FOLLOW_UP = 'FOLLOW_UP',
  OCCASION = 'OCCASION',
  STALE_CUSTOMER = 'STALE_CUSTOMER',
}

export enum ReminderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  CANCELED = 'CANCELED',
  FAILED = 'FAILED',
}

/** Bản ghi nhắc việc đã kết thúc (SENT/CANCELED/FAILED) tự xóa sau 90 ngày (dữ liệu kỹ thuật/tạm). */
export const REMINDER_TTL_SECONDS = 90 * 24 * 60 * 60;
/** Nhắc việc đang ở PROCESSING quá lâu (instance chết giữa chừng) thì được nhận lại. */
export const REMINDER_LOCK_TTL_MS = 5 * 60 * 1000;
/** Quá số lần xử lý lỗi này thì bỏ cuộc (FAILED) thay vì thử mãi. */
export const REMINDER_MAX_ATTEMPTS = 5;
/** Trần số nhắc việc xử lý mỗi nhịp 1 phút (phần còn lại để nhịp sau). */
export const REMINDER_BATCH_LIMIT = 500;
