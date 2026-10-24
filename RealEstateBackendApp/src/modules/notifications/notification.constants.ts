/**
 * Loại thông báo (tài liệu 04 mục 3.6.1). Chỉ THÊM giá trị mới (zero-downtime).
 * `IMPORT_COMPLETED`, `EXPORT_READY` (M8) đã khai sẵn để cài đặt thông báo của người dùng không phải đổi sau này.
 */
export enum NotificationType {
  CUSTOMER_ASSIGNED = 'CUSTOMER_ASSIGNED',
  APPOINTMENT_DUE = 'APPOINTMENT_DUE',
  FOLLOW_UP_DUE = 'FOLLOW_UP_DUE',
  CARE_LOG_ADDED = 'CARE_LOG_ADDED',
  STALE_CUSTOMER = 'STALE_CUSTOMER',
  CUSTOMER_OCCASION = 'CUSTOMER_OCCASION',
  CARE_TEAM_JOIN_REQUESTED = 'CARE_TEAM_JOIN_REQUESTED',
  CARE_TEAM_JOIN_RESOLVED = 'CARE_TEAM_JOIN_RESOLVED',
  IMPORT_COMPLETED = 'IMPORT_COMPLETED',
  EXPORT_READY = 'EXPORT_READY',
  /** Thêm ở M5: cảnh báo truy cập bất thường (dò SĐT, xem số/CCCD dồn dập) gửi cho Quản trị. */
  SECURITY_ALERT = 'SECURITY_ALERT',
}

export enum NotificationPriority {
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
}

/** Trạng thái đẩy push. M5 chỉ có `NoopPushProvider` nên mọi thông báo là `SKIPPED`; M7 (FCM) dùng đủ 4 giá trị. */
export enum NotificationPushStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

/** Thông báo tự xóa sau 180 ngày (dữ liệu kỹ thuật/tạm, tài liệu 04 mục 3.6). */
export const NOTIFICATION_TTL_SECONDS = 180 * 24 * 60 * 60;
export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 500;
/** Số id tối đa một lần đánh dấu đã đọc hàng loạt. */
export const NOTIFICATION_BULK_MAX_IDS = 200;
/** Số loại thông báo tối đa gửi trong bộ lọc `types`. */
export const NOTIFICATION_TYPES_FILTER_MAX = 20;
