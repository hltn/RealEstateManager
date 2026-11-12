import { NotificationPushStatus } from '../notification.constants';
import { PushUrgency } from './push-catalog';

/** Injection token của nhà cung cấp push (`WebPushProvider` khi bật cờ và đủ `VAPID_*`, ngược lại `NoopPushProvider`). */
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/** Thiết bị nhận push: đúng hình dạng `PushSubscription` của trình duyệt (`endpoint` + `keys`). */
export interface PushSubscriptionTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Nội dung push (JSON, dưới 1 KB): do `push-content.renderer.ts` dựng, không chứa PII ngoài `{tên khách}`. */
export interface PushPayload {
  title: string;
  body: string;
  /** Đường dẫn nội bộ bắt đầu bằng `/`. */
  url: string;
  /** `= notificationId`: service worker dùng để thay thế bản trùng. */
  tag: string;
  type: string;
}

/** Tùy chọn mỗi lần gửi, lấy từ danh mục push (FR-43). */
export interface PushSendOptions {
  /** Thời gian dịch vụ push giữ tin khi thiết bị offline (giây). */
  ttlSeconds: number;
  urgency: PushUrgency;
  /** Web Push `Topic` (≤ 32 ký tự base64url): bản trùng thay thế bản đang chờ. Sai định dạng thì bỏ qua. */
  topic?: string;
}

/**
 * Kết quả gửi tới MỘT subscription:
 * - `SENT`: dịch vụ push nhận (2xx, thường 201).
 * - `GONE`: 404/410, subscription đã hết hạn, phải thu hồi, không retry.
 * - `PERMANENT`: lỗi không thể khỏi bằng cách thử lại (400/401/403/413, endpoint/khóa/payload sai, 3xx, 4xx khác).
 * - `TRANSIENT`: 429/5xx/timeout/lỗi mạng, worker ném lỗi để BullMQ retry.
 */
export type PushSendOutcome = 'SENT' | 'GONE' | 'PERMANENT' | 'TRANSIENT';

export interface PushSendResult {
  outcome: PushSendOutcome;
  /** Mã HTTP của dịch vụ push (không có khi timeout/lỗi mạng/lỗi kiểm tra trước khi gửi). */
  statusCode?: number;
}

/**
 * Cổng đẩy thông báo ra thiết bị. `NotificationsService` hỏi `isEnabled()`/`initialStatus()` khi ghi thông báo
 * để đặt `pushStatus`: nhà cung cấp tắt thì thông báo vẫn vào hộp thông báo trong app với `pushStatus = SKIPPED`.
 * Worker `push.send` gọi `send()` cho từng subscription và tự quyết retry/thu hồi theo `PushSendResult`.
 */
export interface PushProvider {
  readonly name: string;
  isEnabled(): boolean;
  /** Trạng thái ban đầu của thông báo vừa ghi: `PENDING` (chờ worker gửi) hoặc `SKIPPED`. */
  initialStatus(): NotificationPushStatus;
  /** Gửi một push tới một subscription; KHÔNG ném lỗi, mọi lỗi được phân loại vào `outcome`. */
  send(
    subscription: PushSubscriptionTarget,
    payload: PushPayload,
    options: PushSendOptions,
  ): Promise<PushSendResult>;
}
