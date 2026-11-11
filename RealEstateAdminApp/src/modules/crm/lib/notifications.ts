/**
 * Hộp thông báo trong app (05 §2.10): nhãn loại thông báo và quy đổi `deepLink` của backend sang route của Web Admin.
 * Hàm thuần. Nội dung thông báo không chứa SĐT/CCCD (backend đảm bảo); KHÔNG ghi log nội dung ở client.
 */

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  CUSTOMER_ASSIGNED: 'Được phân khách',
  APPOINTMENT_DUE: 'Lịch hẹn',
  FOLLOW_UP_DUE: 'Việc cần làm',
  CARE_LOG_ADDED: 'Nhật ký mới',
  CUSTOMER_STATUS_AUTO_CHANGED: 'Tự đổi trạng thái',
  STALE_CUSTOMER: 'Khách lâu chưa chăm sóc',
  CUSTOMER_OCCASION: 'Dịp đặc biệt',
  // Luồng xin tham gia đã bỏ ở v1.0.5: thông báo cũ vẫn hiển thị (nhãn bên dưới) nhưng không còn link/hành động.
  CARE_TEAM_JOIN_REQUESTED: 'Đề nghị tham gia',
  CARE_TEAM_JOIN_RESOLVED: 'Kết quả đề nghị',
  IMPORT_COMPLETED: 'Nhập file xong',
  EXPORT_READY: 'File xuất sẵn sàng',
  SECURITY_ALERT: 'Cảnh báo bảo mật',
};

export const getNotificationTypeLabel = (type: string): string => NOTIFICATION_TYPE_LABELS[type] ?? 'Thông báo';

/** Loại thông báo của luồng xin tham gia đã bỏ: chỉ hiển thị, không điều hướng (màn duyệt không còn). */
const RETIRED_ACTION_TYPES = new Set(['CARE_TEAM_JOIN_REQUESTED']);

const CUSTOMER_PATH = /^\/crm\/customers\/([A-Za-z0-9]+)\/?$/;

/**
 * `deepLink` của backend -> đường dẫn Web Admin (hoặc null nếu không có màn tương ứng):
 * - `/crm/customers/:id` -> giữ nguyên; `/crm/appointments...` -> màn lịch hẹn.
 * - Thông báo cũ của luồng xin tham gia (đã bỏ ở v1.0.5): loại `CARE_TEAM_JOIN_REQUESTED` hoặc `deepLink` trỏ tới màn duyệt cũ -> null (CỐ Ý: không link,
 *   không hành động; không đổi hướng sang hồ sơ khách vì không còn gì để duyệt).
 * - `/crm/audit-logs...` (cảnh báo bảo mật) -> chưa có màn ở Web Admin: không điều hướng.
 */
export const resolveNotificationPath = (notification: { type?: string; deepLink: string; customerId?: string; appointmentId?: string }): string | null => {
  if (notification.type && RETIRED_ACTION_TYPES.has(notification.type)) return null;
  const link = notification.deepLink.split('?')[0];
  if (link === '/crm/care-team-requests') return null;
  if (CUSTOMER_PATH.test(link)) return link;
  if (link.startsWith('/crm/appointments')) return '/crm/appointments';
  if (notification.customerId && link.startsWith('/crm/')) return `/crm/customers/${notification.customerId}`;
  if (notification.appointmentId) return '/crm/appointments';
  return null;
};
