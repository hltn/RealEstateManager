import { describe, expect, it } from 'vitest';
import type { InstallEnvironment } from './iosInstallHintLogic';
import {
  PUSH_REFRESH_INTERVAL_MS,
  isPushRefreshDue,
  isSameKey,
  resolveDeviceState,
  urlBase64ToUint8Array,
  type PushCapabilities,
} from './pushDeviceState';

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

const makeInstall = (overrides: Partial<InstallEnvironment> = {}): InstallEnvironment => ({
  userAgent: ANDROID_CHROME_UA,
  platform: 'Linux armv81',
  maxTouchPoints: 5,
  isStandalone: false,
  ...overrides,
});

const fullCapabilities: PushCapabilities = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: 'default' };

describe('resolveDeviceState (máy trạng thái thiết bị push, FR-09)', () => {
  it('FR-09: iPhone Safari CHƯA cài (không standalone) -> needs-install dù thiếu PushManager (không phải unsupported)', () => {
    const state = resolveDeviceState({
      install: makeInstall({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone' }),
      capabilities: { hasServiceWorker: true, hasPushManager: false, hasNotification: false, permission: 'default' },
      hasSubscription: false,
    });
    expect(state).toBe('needs-install');
  });

  it('FR-09: iPhone Safari đã cài (standalone) có đủ API thì được bật (ready)', () => {
    const state = resolveDeviceState({
      install: makeInstall({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', isStandalone: true }),
      capabilities: fullCapabilities,
      hasSubscription: false,
    });
    expect(state).toBe('ready');
  });

  it('FR-09: Chrome trên iPhone (không phải Safari) không hỗ trợ push -> unsupported, không needs-install', () => {
    const state = resolveDeviceState({
      install: makeInstall({ userAgent: IPHONE_CHROME_UA, platform: 'iPhone' }),
      capabilities: { hasServiceWorker: true, hasPushManager: false, hasNotification: false, permission: 'default' },
      hasSubscription: false,
    });
    expect(state).toBe('unsupported');
  });

  it.each([
    ['thiếu service worker', { hasServiceWorker: false }],
    ['thiếu PushManager', { hasPushManager: false }],
    ['thiếu Notification', { hasNotification: false }],
  ])('FR-09: %s -> unsupported', (_label, patch) => {
    expect(resolveDeviceState({ install: makeInstall(), capabilities: { ...fullCapabilities, ...patch }, hasSubscription: false })).toBe('unsupported');
  });

  it('FR-09: quyền bị chặn (denied) -> blocked, kể cả khi còn subscription cũ', () => {
    const capabilities = { ...fullCapabilities, permission: 'denied' as const };
    expect(resolveDeviceState({ install: makeInstall(), capabilities, hasSubscription: false })).toBe('blocked');
    expect(resolveDeviceState({ install: makeInstall(), capabilities, hasSubscription: true })).toBe('blocked');
  });

  it('FR-09: hỗ trợ + quyền default, chưa đăng ký -> ready (hiện nút Bật)', () => {
    expect(resolveDeviceState({ install: makeInstall(), capabilities: fullCapabilities, hasSubscription: false })).toBe('ready');
  });

  it('FR-09: quyền granted nhưng chưa có subscription -> ready; có subscription -> subscribed', () => {
    const capabilities = { ...fullCapabilities, permission: 'granted' as const };
    expect(resolveDeviceState({ install: makeInstall(), capabilities, hasSubscription: false })).toBe('ready');
    expect(resolveDeviceState({ install: makeInstall(), capabilities, hasSubscription: true })).toBe('subscribed');
  });

  it('FR-09: có subscription nhưng quyền còn default (đã bị reset) -> ready, không coi là subscribed', () => {
    expect(resolveDeviceState({ install: makeInstall(), capabilities: fullCapabilities, hasSubscription: true })).toBe('ready');
  });
});

describe('isPushRefreshDue (làm tươi tối đa 1 lần/24 giờ, FR-09)', () => {
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);

  it('FR-09: chưa từng làm tươi hoặc giá trị hỏng -> đến hạn', () => {
    expect(isPushRefreshDue(null, now)).toBe(true);
    expect(isPushRefreshDue(Number.NaN, now)).toBe(true);
  });

  it('FR-09: 23 giờ 59 phút chưa đến hạn; đúng 24 giờ và hơn thì đến hạn', () => {
    expect(isPushRefreshDue(now - PUSH_REFRESH_INTERVAL_MS + 60_000, now)).toBe(false);
    expect(isPushRefreshDue(now - PUSH_REFRESH_INTERVAL_MS, now)).toBe(true);
    expect(isPushRefreshDue(now - PUSH_REFRESH_INTERVAL_MS - 1, now)).toBe(true);
  });

  it('FR-09: vừa làm tươi (cùng thời điểm) thì chưa đến hạn', () => {
    expect(isPushRefreshDue(now, now)).toBe(false);
  });

  it('FR-09: mốc ở tương lai (đồng hồ chỉnh lùi) coi như đến hạn để không kẹt', () => {
    expect(isPushRefreshDue(now + 1000, now)).toBe(true);
  });
});

describe('urlBase64ToUint8Array / isSameKey (khóa VAPID, FR-09)', () => {
  it('FR-09: giải mã base64url (có - và _, thiếu padding) ra đúng bytes', () => {
    // bytes [0xfb, 0xff, 0xfe] = "+//+" ở base64 chuẩn = "-__-" ở base64url
    expect(Array.from(urlBase64ToUint8Array('-__-'))).toEqual([0xfb, 0xff, 0xfe]);
    // "AQI" (thiếu padding "=") = [1, 2]
    expect(Array.from(urlBase64ToUint8Array('AQI'))).toEqual([1, 2]);
  });

  it('FR-09: isSameKey so theo bytes; khác độ dài/khác giá trị/null thì false', () => {
    const key = urlBase64ToUint8Array('AQID');
    expect(isSameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
    expect(isSameKey(new Uint8Array([1, 2, 4]).buffer, key)).toBe(false);
    expect(isSameKey(new Uint8Array([1, 2]).buffer, key)).toBe(false);
    expect(isSameKey(null, key)).toBe(false);
  });
});
