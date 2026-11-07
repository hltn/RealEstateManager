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

/**
 * `crm_attachments.status`. Ảnh upload xong vào thẳng `READY` (không chờ xử lý); từ v1.0.4 job `attachment.thumbnail`
 * chạy bất đồng bộ sau đó để sinh thumbnail và chỉ cập nhật `thumbStatus`, không đổi `status`.
 */
export enum AttachmentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ATTACHED = 'ATTACHED',
  REJECTED = 'REJECTED',
  REMOVED = 'REMOVED',
}

/**
 * `crm_attachments.thumbStatus` (FR-26). Thiếu field (ảnh cũ) coi như `NONE`; `FAILED` = job thumbnail hết lượt
 * thử, ảnh vẫn dùng được (`thumbUrl` rơi về `url`) và không được bù lại.
 */
export enum ThumbStatus {
  NONE = 'NONE',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum AttachmentKind {
  CARE_LOG_IMAGE = 'CARE_LOG_IMAGE',
}

export const CARE_LOG_CONTENT_MAX_LENGTH = 5000;
export const CARE_LOG_SUGGESTION_MAX_LENGTH = 500;
/** Tối đa 5 ảnh cho mỗi ghi chú (quyết định #5). */
export const MAX_ATTACHMENTS_PER_CARE_LOG = 5;
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
