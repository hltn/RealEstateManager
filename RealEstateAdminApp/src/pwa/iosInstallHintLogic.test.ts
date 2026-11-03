import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IOS_INSTALL_HINT_DISMISSED_KEY,
  isIosSafari,
  readInstallEnvironment,
  readIosInstallHintDismissed,
  saveIosInstallHintDismissed,
  shouldShowIosInstallHint,
  type InstallEnvironment,
} from './iosInstallHintLogic';

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1';
const IPHONE_ZALO_UA = `${IPHONE_SAFARI_UA} Zalo/22.1`;
/** WKWebView trong app khác: có AppleWebKit và Mobile/ nhưng KHÔNG có token `Safari/`. */
const IPHONE_WEBVIEW_NO_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
/** iPadOS 13+ và Mac dùng chung UA Macintosh; chỉ phân biệt được bằng cảm ứng đa điểm. */
const MACINTOSH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const env = (overrides: Partial<InstallEnvironment> = {}): InstallEnvironment => ({
  userAgent: IPHONE_SAFARI_UA,
  platform: 'iPhone',
  maxTouchPoints: 5,
  isStandalone: false,
  ...overrides,
});

describe('isIosSafari', () => {
  it('nhận iPhone Safari', () => {
    expect(isIosSafari(env())).toBe(true);
  });

  it('nhận iPadOS (UA giả Mac nhưng có cảm ứng đa điểm)', () => {
    expect(isIosSafari(env({ userAgent: MACINTOSH_UA, platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true);
  });

  it('không nhận webview iOS không có token "Safari/" (kể cả khi không nằm trong danh sách đen)', () => {
    expect(isIosSafari(env({ userAgent: IPHONE_WEBVIEW_NO_SAFARI_UA }))).toBe(false);
    // iPad giả Mac nhưng là webview: cũng không có Safari/.
    expect(isIosSafari(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(false);
  });

  it('không nhận Mac thật (không cảm ứng), Android, Chrome iOS và webview Zalo', () => {
    expect(isIosSafari(env({ userAgent: MACINTOSH_UA, platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
    expect(isIosSafari(env({ userAgent: ANDROID_UA, platform: 'Linux armv81' }))).toBe(false);
    expect(isIosSafari(env({ userAgent: IPHONE_CHROME_UA }))).toBe(false);
    expect(isIosSafari(env({ userAgent: IPHONE_ZALO_UA }))).toBe(false);
  });
});

describe('shouldShowIosInstallHint', () => {
  const base = { environment: env(), isAuthenticated: true, isDismissed: false };

  it('hiện khi iOS Safari + chưa cài + đã đăng nhập + chưa tắt', () => {
    expect(shouldShowIosInstallHint(base)).toBe(true);
  });

  it('ẩn khi đã chạy standalone (đã cài)', () => {
    expect(shouldShowIosInstallHint({ ...base, environment: env({ isStandalone: true }) })).toBe(false);
  });

  it('ẩn khi không phải iOS Safari', () => {
    expect(shouldShowIosInstallHint({ ...base, environment: env({ userAgent: ANDROID_UA, platform: 'Linux armv81' }) })).toBe(false);
  });

  it('ẩn khi người dùng đã tắt', () => {
    expect(shouldShowIosInstallHint({ ...base, isDismissed: true })).toBe(false);
  });

  it('ẩn khi chưa đăng nhập (trang login)', () => {
    expect(shouldShowIosInstallHint({ ...base, isAuthenticated: false })).toBe(false);
  });
});

describe('cờ đã tắt trong localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('mặc định chưa tắt; sau khi lưu thì đọc lại được', () => {
    expect(readIosInstallHintDismissed()).toBe(false);
    saveIosInstallHintDismissed();
    expect(localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY)).toBe('true');
    expect(readIosInstallHintDismissed()).toBe(true);
  });

  it('giá trị lạ không bị coi là đã tắt', () => {
    localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, 'yes');
    expect(readIosInstallHintDismissed()).toBe(false);
  });
});

describe('cờ đã tắt khi localStorage ném lỗi (Safari private mode / bị chặn)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('đọc lỗi thì coi như chưa tắt (không văng lỗi làm trắng màn hình)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readIosInstallHintDismissed()).toBe(false);
  });

  it('ghi lỗi (quota/private mode) thì bỏ qua, không văng lỗi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => saveIosInstallHintDismissed()).not.toThrow();
  });
});

describe('readInstallEnvironment: phát hiện standalone', () => {
  const setStandaloneFlag = (value: boolean | undefined) => Object.defineProperty(navigator, 'standalone', { value, configurable: true });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'standalone');
  });

  it('display-mode: standalone (Android/Chrome đã cài) => isStandalone', () => {
    setStandaloneFlag(undefined);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' }));
    expect(readInstallEnvironment().isStandalone).toBe(true);
  });

  it('navigator.standalone === true (iOS Màn hình chính) => isStandalone dù matchMedia không khớp', () => {
    setStandaloneFlag(true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(readInstallEnvironment().isStandalone).toBe(true);
  });

  it('tab trình duyệt thường (matchMedia không khớp, không có cờ iOS) => không standalone', () => {
    setStandaloneFlag(undefined);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(readInstallEnvironment().isStandalone).toBe(false);
  });

  it('thiếu matchMedia (môi trường cũ/test) không văng lỗi', () => {
    setStandaloneFlag(undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(readInstallEnvironment().isStandalone).toBe(false);
  });
});
