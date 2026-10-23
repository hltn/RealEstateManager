/** Kênh liên hệ của một nhật ký chăm sóc (tài liệu 04 mục 3.5). */
export enum ContactChannel {
  CALL = 'CALL',
  ZALO = 'ZALO',
  SMS = 'SMS',
  MEETING = 'MEETING',
  SITE_VISIT = 'SITE_VISIT',
  OTHER = 'OTHER',
}

export enum CareLogSource {
  MANUAL = 'MANUAL',
  IMPORT = 'IMPORT',
  SYSTEM = 'SYSTEM',
}

/** `crm_attachments.status`. M3 không có job xử lý ảnh nên ảnh upload xong vào thẳng `READY`. */
export enum AttachmentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ATTACHED = 'ATTACHED',
  REJECTED = 'REJECTED',
  REMOVED = 'REMOVED',
}

export enum AttachmentKind {
  CARE_LOG_IMAGE = 'CARE_LOG_IMAGE',
}

export const CARE_LOG_CONTENT_MAX_LENGTH = 5000;
export const CARE_LOG_SUGGESTION_MAX_LENGTH = 500;
/** Tối đa 5 ảnh cho mỗi ghi chú (quyết định #5). */
export const MAX_ATTACHMENTS_PER_CARE_LOG = 5;
/** Tác giả chỉ sửa/xóa nhật ký (hoặc gỡ ảnh đã gắn) trong 24 giờ kể từ khi tạo (ma trận 04 mục 4.2). */
export const CARE_LOG_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Ảnh đã tải lên nhưng chưa gắn quá ngần này thì bị dọn. */
export const ORPHAN_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Số ảnh chưa gắn tối đa mỗi người trên mỗi khách (chống dồn rác vào kho lưu trữ). */
export const MAX_UNATTACHED_PER_UPLOADER = 20;
/** `occurredAt` được lệch tối đa so với giờ server (đồng hồ thiết bị lệch). */
export const OCCURRED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const ATTACHMENT_ORIGINAL_NAME_MAX_LENGTH = 255;

/** Thư mục logic trong bucket: `customers/<customerId>/care-logs/`. */
export const attachmentPrefix = (customerId: string): string =>
  `customers/${customerId}/care-logs/`;
