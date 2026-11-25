/**
 * Logic thuần của hộp thoại mời bật thông báo (FR-28, Architecture 6.4): khi nào hỏi, và kết quả sau khi bấm "Bật".
 * Không đọc DOM/localStorage/mạng để vitest kiểm đủ nhánh; phần chạm môi trường nằm ở `usePushOptIn.ts`.
 */
import type { PushPermission } from './pushDeviceState';
import type { PushOptInChoice } from './pushOptInStorage';

/** Điều kiện chỉ cần biết ở phía thiết bị/người dùng, chưa cần hỏi máy chủ. */
export interface PushOptInLocalConditions {
  isAuthenticated: boolean;
  /** App đang chạy từ icon Màn hình chính (PWA đã cài), không phải tab trình duyệt. */
  isStandalone: boolean;
  /** `Notification.permission` hiện tại. */
  permission: PushPermission;
  /** Kết quả đã ghi ở localStorage của thiết bị; `null` là chưa hỏi bao giờ. */
  storedChoice: PushOptInChoice | null;
}

export interface PushOptInConditions extends PushOptInLocalConditions {
  /** `GET /push-subscriptions/config` có `enabled = true`. */
  isServerEnabled: boolean;
  /** Thiết bị bật được thông báo ngay (trạng thái `ready`): không hứa hẹn với thiết bị không hỗ trợ (iOS cũ, thiếu PushManager). */
  isDeviceReady: boolean;
}

/**
 * Phần điều kiện kiểm được TRƯỚC khi hỏi máy chủ: đã đăng nhập, đang standalone, quyền chưa `granted`/`denied`, thiết bị chưa ghi kết quả.
 * Dùng để quyết định có đáng gọi API cấu hình push hay không (tab trình duyệt bình thường không phát sinh request nào).
 */
export const isPushOptInLocallyEligible = ({ isAuthenticated, isStandalone, permission, storedChoice }: PushOptInLocalConditions): boolean =>
  isAuthenticated && isStandalone && permission !== 'granted' && permission !== 'denied' && storedChoice === null;

/**
 * Có nên MỜI lúc này không: MỌI điều kiện đều đạt. Chỉ dùng để quyết định mở hộp; sau khi đã mở, `usePushOptIn` giữ hộp mở trong phiên
 * tới khi có kết quả được ghi (`storedChoice`), vì quyền đọc lại có thể đã đổi do chính thao tác của người dùng. Nhờ `storedChoice`, mỗi thiết bị chỉ được hỏi một lần.
 */
export const shouldShowPushOptIn = (conditions: PushOptInConditions): boolean =>
  isPushOptInLocallyEligible(conditions) && conditions.isServerEnabled && conditions.isDeviceReady;

/** Kết quả sau khi bấm "Bật": `enabled` (đăng ký xong), `denied` (trình duyệt từ chối quyền), `failed` (lỗi khác, hoặc đóng hộp xin quyền mà không chọn). */
export type PushOptInOutcome = 'enabled' | 'denied' | 'failed';

interface ResolveOutcomeParams {
  /** `enable()` trả đăng ký (không phải `null`). */
  isRegistered: boolean;
  /** Quyền đọc NGAY SAU khi `enable()` xong. */
  permission: PushPermission;
}

export const resolvePushOptInOutcome = ({ isRegistered, permission }: ResolveOutcomeParams): PushOptInOutcome => {
  if (isRegistered) return 'enabled';
  return permission === 'denied' ? 'denied' : 'failed';
};
