/**
 * Nhận diện nền tảng để quyết định nút "Cài app" nào hiện ở màn đăng nhập (FR-27, đồng bộ từ Admin App).
 * Chép thuần từ `RealEstateAdminApp/src/pwa/installPlatform.ts` + phần môi trường/Safari của `iosInstallHintLogic.ts`.
 * Prototype không có manifest/service worker nên KHÔNG có phần bắt `beforeinstallprompt`.
 * Hàm thuần (không đụng window) để test đủ chuỗi User-Agent; phần đọc môi trường thật là `readInstallEnvironment`.
 */

/** Safari thật luôn có token `Safari/` trong UA; WKWebView trong app khác (Zalo, Facebook...) thường KHÔNG có. */
const SAFARI_TOKEN_PATTERN = /Safari\//;

/** Trình duyệt iOS KHÁC Safari (Chrome/Firefox/Edge/Opera/Google app) và webview trong app (Zalo, Facebook, Instagram, Line): hướng dẫn Safari không áp dụng. */
const NON_SAFARI_IOS_PATTERN = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Zalo|Line\//i;

export interface InstallEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Đang chạy từ icon Màn hình chính (standalone). */
  isStandalone: boolean;
}

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

/**
 * iPhone/iPod/iPad Safari: thiết bị iOS + UA có `Safari/`, RỒI MỚI loại danh sách đen (Chrome/Firefox/... và webview có thêm tên app).
 * iPadOS 13+ khai báo UA là Macintosh (vẫn có `Safari/`) nên nhận diện thêm bằng cảm ứng đa điểm.
 */
export const isIosSafari = ({ userAgent, platform, maxTouchPoints }: InstallPlatformSignals): boolean => {
  const isIosDevice = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return isIosDevice && SAFARI_TOKEN_PATTERN.test(userAgent) && !NON_SAFARI_IOS_PATTERN.test(userAgent);
};

/** Đọc môi trường trình duyệt hiện tại (chạy ở client; matchMedia có thể thiếu ở môi trường test). */
export const readInstallEnvironment = (): InstallEnvironment => {
  const isStandaloneMedia = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    // `navigator.standalone` là thuộc tính riêng của iOS Safari (true khi mở từ Màn hình chính).
    isStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true || isStandaloneMedia,
  };
};
