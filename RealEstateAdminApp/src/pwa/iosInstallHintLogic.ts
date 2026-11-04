/**
 * Logic hiện gợi ý "Thêm vào MH chính" cho iPhone/iPad Safari (iOS không có prompt cài đặt tự động như Android).
 * Tách thành hàm thuần để test đủ các nhánh; phần đọc môi trường thật nằm ở `readInstallEnvironment`.
 */

/** Cờ localStorage: người dùng đã bấm "Đã hiểu" thì không hiện lại. */
export const IOS_INSTALL_HINT_DISMISSED_KEY = 'pwa.iosInstallHintDismissed';

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
 * iPhone/iPod/iPad Safari: thiết bị iOS + UA có `Safari/`, RỒI MỚI loại danh sách đen (Chrome/Firefox/... và webview có thêm tên app).
 * iPadOS 13+ khai báo UA là Macintosh (vẫn có `Safari/`) nên nhận diện thêm bằng cảm ứng đa điểm.
 */
export const isIosSafari = ({ userAgent, platform, maxTouchPoints }: Pick<InstallEnvironment, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean => {
  const isIosDevice = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return isIosDevice && SAFARI_TOKEN_PATTERN.test(userAgent) && !NON_SAFARI_IOS_PATTERN.test(userAgent);
};

interface ShouldShowParams {
  environment: InstallEnvironment;
  isAuthenticated: boolean;
  isDismissed: boolean;
}

/** Chỉ hiện khi: iOS Safari, chưa cài (không standalone), đã đăng nhập và chưa tắt. */
export const shouldShowIosInstallHint = ({ environment, isAuthenticated, isDismissed }: ShouldShowParams): boolean =>
  isAuthenticated && !isDismissed && !environment.isStandalone && isIosSafari(environment);

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

/** Đọc cờ đã tắt; localStorage lỗi (private mode) coi như chưa tắt. */
export const readIosInstallHintDismissed = (): boolean => {
  try {
    return localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const saveIosInstallHintDismissed = (): void => {
  try {
    localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, 'true');
  } catch {
    // Bỏ qua lỗi quota/private mode: lần sau chỉ hiện lại gợi ý.
  }
};
