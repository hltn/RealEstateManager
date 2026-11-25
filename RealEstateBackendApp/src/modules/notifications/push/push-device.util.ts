import {
  PUSH_DEVICE_LABEL_MAX_LENGTH,
  PushPlatform,
} from './push-subscription.constants';

export interface PushDeviceInfo {
  platform: PushPlatform;
  deviceLabel: string;
}

const FALLBACK_LABEL = 'Thiết bị khác';

/** Tên thiết bị theo thứ tự ưu tiên (iPhone/iPad phải xét trước "Mac" vì UA có thể chứa cả hai). */
const DEVICE_RULES: Array<{
  test: RegExp;
  label: string;
  platform: PushPlatform;
}> = [
  { test: /iPhone|iPod/i, label: 'iPhone', platform: PushPlatform.IOS },
  { test: /iPad/i, label: 'iPad', platform: PushPlatform.IOS },
  { test: /Android/i, label: 'Android', platform: PushPlatform.ANDROID },
  { test: /Windows/i, label: 'Windows', platform: PushPlatform.DESKTOP },
  { test: /CrOS/i, label: 'ChromeOS', platform: PushPlatform.DESKTOP },
  { test: /Macintosh|Mac OS X/i, label: 'Mac', platform: PushPlatform.DESKTOP },
  { test: /Linux|X11/i, label: 'Linux', platform: PushPlatform.DESKTOP },
];

/** Trình duyệt theo thứ tự ưu tiên (Edge/Opera/Chrome iOS đều có chuỗi "Safari"/"Chrome" nên xét trước). */
const BROWSER_RULES: Array<{ test: RegExp; label: string }> = [
  { test: /EdgA?\/|Edg\/|EdgiOS\//, label: 'Edge' },
  { test: /OPR\/|OPiOS\//, label: 'Opera' },
  { test: /Firefox\/|FxiOS\//, label: 'Firefox' },
  { test: /SamsungBrowser\//, label: 'Samsung Internet' },
  { test: /CriOS\/|Chrome\//, label: 'Chrome' },
  { test: /Safari\//, label: 'Safari' },
];

/**
 * Suy nền tảng và nhãn hiển thị ("iPhone · Safari") từ `User-Agent`. Chỉ giữ nhãn đã chuẩn hóa, KHÔNG lưu UA thô
 * (FR-01, Architecture 3.2). UA lạ/thiếu: `OTHER` + nhãn chung.
 */
export const deriveDeviceInfo = (
  userAgent: string | undefined | null,
): PushDeviceInfo => {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const device = DEVICE_RULES.find((rule) => rule.test.test(ua));
  const browser = BROWSER_RULES.find((rule) => rule.test.test(ua));
  const parts = [device?.label, browser?.label].filter((part): part is string =>
    Boolean(part),
  );
  const label = parts.length > 0 ? parts.join(' · ') : FALLBACK_LABEL;
  return {
    platform: device?.platform ?? PushPlatform.OTHER,
    deviceLabel: label.slice(0, PUSH_DEVICE_LABEL_MAX_LENGTH),
  };
};
