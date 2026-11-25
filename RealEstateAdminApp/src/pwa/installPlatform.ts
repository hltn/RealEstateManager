/**
 * Nhận diện nền tảng để quyết định nút "Cài app" nào hiện ở màn đăng nhập (FR-27).
 * Hàm thuần (không đụng window) để test đủ chuỗi User-Agent; phần đọc môi trường thật dùng `readInstallEnvironment`.
 */
import type { InstallEnvironment } from './iosInstallHintLogic';

/**
 * - `android`: Android (Chrome/Samsung Internet...).
 * - `ios`: iPhone/iPod/iPad, kể cả iPadOS 13+ (UA báo Macintosh nhưng có cảm ứng đa điểm).
 * - `other`: máy tính (Windows/Mac/Linux/ChromeOS) và mọi thứ nhận ra là không phải điện thoại.
 * - `unknown`: không có UA hoặc UA lạ, không đoán được.
 */
export type InstallPlatform = 'android' | 'ios' | 'other' | 'unknown';

/** Tín hiệu trình duyệt cần cho việc nhận diện (tập con của `InstallEnvironment`, truyền thẳng `readInstallEnvironment()` được). */
export type InstallPlatformSignals = Pick<InstallEnvironment, 'userAgent' | 'platform' | 'maxTouchPoints'>;

const ANDROID_PATTERN = /Android/i;
const IOS_DEVICE_PATTERN = /iPhone|iPad|iPod/;
const MAC_DESKTOP_PATTERN = /Macintosh/;
const DESKTOP_PATTERN = /Windows|Macintosh|X11|CrOS|Linux/;

/**
 * Thứ tự: Android, rồi iOS (iPhone/iPad/iPod hoặc iPadOS giả Macintosh có `maxTouchPoints > 1`; Mac thật có 0 điểm chạm nên không nhầm),
 * rồi máy tính, còn lại là `unknown`.
 */
export const detectInstallPlatform = ({ userAgent, platform, maxTouchPoints }: InstallPlatformSignals): InstallPlatform => {
  if (ANDROID_PATTERN.test(userAgent)) return 'android';
  const isMacLike = MAC_DESKTOP_PATTERN.test(userAgent) || platform === 'MacIntel';
  if (IOS_DEVICE_PATTERN.test(userAgent) || (isMacLike && maxTouchPoints > 1)) return 'ios';
  if (DESKTOP_PATTERN.test(userAgent)) return 'other';
  return 'unknown';
};

export interface InstallButtonVisibility {
  isAndroidVisible: boolean;
  isIosVisible: boolean;
}

/** Android chỉ hiện nút Android, iOS chỉ hiện nút iOS; máy tính và không nhận ra thì hiện cả hai (Oniichan chốt 2026-11-13). */
export const resolveInstallButtons = (platform: InstallPlatform): InstallButtonVisibility => ({
  isAndroidVisible: platform !== 'ios',
  isIosVisible: platform !== 'android',
});
