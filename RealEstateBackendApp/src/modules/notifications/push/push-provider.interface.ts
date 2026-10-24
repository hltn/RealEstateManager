import { NotificationPushStatus } from '../notification.constants';

/** Injection token của nhà cung cấp push (M5: `NoopPushProvider`; M7: `FcmPushProvider`). */
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/**
 * Cổng đẩy thông báo ra thiết bị. `NotificationsService` hỏi `isEnabled()` khi ghi thông báo để đặt `pushStatus`:
 * nhà cung cấp tắt thì thông báo vẫn vào hộp thông báo trong app với `pushStatus = SKIPPED`.
 * Việc gửi thật (hàng đợi `push.send`, device token, retry/backoff, thu hồi token hỏng) thuộc M7.
 */
export interface PushProvider {
  readonly name: string;
  isEnabled(): boolean;
  /** Trạng thái ban đầu của thông báo vừa ghi: `PENDING` (chờ worker gửi) hoặc `SKIPPED`. */
  initialStatus(): NotificationPushStatus;
}
