/**
 * Logic thuần của Web Push phía thiết bị (T-40, FR-09, FR-01; Architecture 6.2): máy trạng thái, đổi khóa VAPID, hạn làm tươi 24 giờ.
 * Không đọc DOM/`navigator` để vitest kiểm đủ nhánh; phần chạm trình duyệt nằm ở `pushClient.ts`.
 */
import { isIosSafari, type InstallEnvironment } from './iosInstallHintLogic';

/**
 * Trạng thái của THIẾT BỊ NÀY:
 * - `unsupported`: thiếu service worker/PushManager/Notification (kể cả iOS không phải Safari).
 * - `needs-install`: iPhone/iPad Safari chưa chạy ở chế độ standalone (iOS chỉ cho push khi đã "Thêm vào MH chính"): KHÔNG hiện nút bật.
 * - `blocked`: quyền thông báo là `denied` (không xin lặp, chỉ hướng dẫn mở lại).
 * - `ready`: có thể bấm "Bật thông báo" (xin quyền chỉ sau thao tác bấm).
 * - `subscribed`: đã cấp quyền và đã có subscription trên trình duyệt (hiện "Tắt").
 */
export type PushDeviceState = 'unsupported' | 'needs-install' | 'blocked' | 'ready' | 'subscribed';

/** Quyền thông báo của trình duyệt (giá trị chuẩn của `Notification.permission`). */
export type PushPermission = 'default' | 'granted' | 'denied';

export interface PushCapabilities {
  /** Có service worker đã đăng ký (dev/test không đăng ký nên coi như không hỗ trợ). */
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: PushPermission;
}

interface ResolveDeviceStateParams {
  install: InstallEnvironment;
  capabilities: PushCapabilities;
  /** Đã có `PushSubscription` trên trình duyệt. */
  hasSubscription: boolean;
}

/**
 * Suy ra trạng thái thiết bị. Thứ tự quan trọng: iOS chưa cài kiểm TRƯỚC `unsupported` vì Safari chưa cài không có `PushManager`
 * (phải hiện hướng dẫn cài chứ không phải "không hỗ trợ").
 */
export const resolveDeviceState = ({ install, capabilities, hasSubscription }: ResolveDeviceStateParams): PushDeviceState => {
  if (isIosSafari(install) && !install.isStandalone) return 'needs-install';
  if (!capabilities.hasServiceWorker || !capabilities.hasPushManager || !capabilities.hasNotification) return 'unsupported';
  if (capabilities.permission === 'denied') return 'blocked';
  if (capabilities.permission === 'granted' && hasSubscription) return 'subscribed';
  return 'ready';
};

/** Khoảng tối thiểu giữa hai lần `POST /push-subscriptions` làm tươi `lastSeenAt` (Architecture 6.2: 1 lần/24 giờ). */
export const PUSH_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Đến hạn làm tươi chưa: chưa từng làm, giá trị hỏng, hoặc đã đủ 24 giờ.
 * Mốc ở tương lai (đồng hồ máy bị chỉnh lùi) coi như đến hạn để không kẹt không bao giờ làm tươi.
 */
export const isPushRefreshDue = (lastRefreshAt: number | null, now: number): boolean => {
  if (lastRefreshAt === null || !Number.isFinite(lastRefreshAt) || lastRefreshAt > now) return true;
  return now - lastRefreshAt >= PUSH_REFRESH_INTERVAL_MS;
};

/** Đổi khóa công khai VAPID (base64url, API trả) sang bytes cho `applicationServerKey`. Chuỗi sai định dạng thì ném lỗi. */
export const urlBase64ToUint8Array = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** So hai khóa theo bytes (khóa đã đăng ký với khóa API đang trả; lệch nghĩa là VAPID đã đổi). */
export const isSameKey = (left: ArrayBuffer | null | undefined, right: Uint8Array): boolean => {
  if (!left || left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  return leftBytes.every((value, index) => value === right[index]);
};
