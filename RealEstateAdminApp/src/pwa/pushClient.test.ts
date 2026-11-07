import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushClientError, enablePush, readDeviceSnapshot, toSubscriptionBody, unsubscribeLocalPush } from './pushClient';

/** Khóa VAPID giả 3 byte [1, 2, 3] dạng base64url. */
const KEY_A = 'AQID';
const KEY_A_BYTES = [1, 2, 3];

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  unsubscribe: ReturnType<typeof vi.fn>;
  toJSON: () => PushSubscriptionJSON;
}

const makeSubscription = (keyBytes: number[] = KEY_A_BYTES, overrides: Partial<FakeSubscription> = {}): FakeSubscription => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  options: { applicationServerKey: new Uint8Array(keyBytes).buffer },
  unsubscribe: vi.fn().mockResolvedValue(true),
  toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'P256', auth: 'AUTH' } }),
  ...overrides,
});

interface Setup {
  registration: { pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } } | undefined;
  requestPermission: ReturnType<typeof vi.fn>;
  callOrder: string[];
}

/** Dựng môi trường trình duyệt giả: service worker (có/không registration), PushManager, Notification. */
const setupBrowser = ({ hasRegistration = true, permission = 'default', requestResult = 'granted' as NotificationPermission } = {}): Setup => {
  const callOrder: string[] = [];
  const registration = hasRegistration
    ? { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn() } }
    : undefined;
  const requestPermission = vi.fn(async () => {
    callOrder.push('requestPermission');
    return requestResult;
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => {
        callOrder.push('getRegistration');
        return registration;
      }),
    },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission, requestPermission }));
  return { registration, requestPermission, callOrder };
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('readDeviceSnapshot (FR-09)', () => {
  it('FR-09: dev/test không đăng ký service worker -> unsupported', async () => {
    setupBrowser({ hasRegistration: false });
    expect((await readDeviceSnapshot()).state).toBe('unsupported');
  });

  it('FR-09: quyền denied -> blocked', async () => {
    setupBrowser({ permission: 'denied' });
    expect((await readDeviceSnapshot()).state).toBe('blocked');
  });

  it('FR-09: quyền default, chưa có subscription -> ready', async () => {
    setupBrowser();
    const { state, subscription } = await readDeviceSnapshot();
    expect(state).toBe('ready');
    expect(subscription).toBeNull();
  });

  it('FR-09: quyền granted và có subscription -> subscribed, trả kèm subscription', async () => {
    const setup = setupBrowser({ permission: 'granted' });
    const existing = makeSubscription();
    setup.registration!.pushManager.getSubscription.mockResolvedValue(existing);
    const snapshot = await readDeviceSnapshot();
    expect(snapshot.state).toBe('subscribed');
    expect(snapshot.subscription).toBe(existing);
  });

  it('FR-09: iPhone Safari chưa cài -> needs-install (không đụng tới PushManager)', async () => {
    setupBrowser({ hasRegistration: false });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    expect((await readDeviceSnapshot()).state).toBe('needs-install');
  });

  it('FR-09: chỉ ĐỌC trạng thái, không bao giờ tự xin quyền hay đăng ký', async () => {
    const setup = setupBrowser();
    await readDeviceSnapshot();
    expect(setup.requestPermission).not.toHaveBeenCalled();
    expect(setup.registration!.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('enablePush (xin quyền chỉ sau thao tác bấm, FR-09)', () => {
  it('FR-09: xin quyền là việc ĐẦU TIÊN (trước khi lấy service worker) để còn trong cử chỉ bấm của iOS', async () => {
    const setup = setupBrowser();
    const created = makeSubscription();
    setup.registration!.pushManager.subscribe.mockResolvedValue(created);
    await enablePush(KEY_A);
    expect(setup.callOrder[0]).toBe('requestPermission');
  });

  it('FR-09: đăng ký mới với userVisibleOnly và đúng khóa VAPID; báo isNew', async () => {
    const setup = setupBrowser();
    const created = makeSubscription();
    setup.registration!.pushManager.subscribe.mockResolvedValue(created);
    const result = await enablePush(KEY_A);
    const options = setup.registration!.pushManager.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual(KEY_A_BYTES);
    expect(result).toEqual({ subscription: created, isNew: true });
  });

  it('FR-09: người dùng từ chối quyền -> ném PERMISSION_NOT_GRANTED, không đăng ký', async () => {
    const setup = setupBrowser({ requestResult: 'denied' });
    await expect(enablePush(KEY_A)).rejects.toMatchObject({ code: 'PERMISSION_NOT_GRANTED' });
    expect(setup.registration!.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('FR-09: đóng hộp thoại xin quyền (default) cũng không đăng ký', async () => {
    const setup = setupBrowser({ requestResult: 'default' });
    await expect(enablePush(KEY_A)).rejects.toBeInstanceOf(PushClientError);
    expect(setup.registration!.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('FR-09: chưa có service worker -> ném NO_SERVICE_WORKER', async () => {
    setupBrowser({ hasRegistration: false });
    await expect(enablePush(KEY_A)).rejects.toMatchObject({ code: 'NO_SERVICE_WORKER' });
  });

  it('FR-01: đã có subscription cùng khóa -> dùng lại (isNew = false), không hủy/đăng ký lại', async () => {
    const setup = setupBrowser();
    const existing = makeSubscription();
    setup.registration!.pushManager.getSubscription.mockResolvedValue(existing);
    const result = await enablePush(KEY_A);
    expect(result).toEqual({ subscription: existing, isNew: false });
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(setup.registration!.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('FR-01: subscription cũ khác khóa VAPID (khóa đã đổi) -> hủy rồi đăng ký lại bằng khóa mới', async () => {
    const setup = setupBrowser();
    const stale = makeSubscription([9, 9, 9]);
    const fresh = makeSubscription();
    setup.registration!.pushManager.getSubscription.mockResolvedValue(stale);
    setup.registration!.pushManager.subscribe.mockResolvedValue(fresh);
    const result = await enablePush(KEY_A);
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ subscription: fresh, isNew: true });
  });
});

describe('toSubscriptionBody (FR-01)', () => {
  it('FR-01: đổi toJSON() sang thân POST đủ endpoint, khóa, expirationTime', () => {
    expect(toSubscriptionBody(makeSubscription() as unknown as PushSubscription)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'P256', auth: 'AUTH' },
      expirationTime: null,
    });
  });

  it.each([
    ['thiếu endpoint', { keys: { p256dh: 'a', auth: 'b' } }],
    ['thiếu khóa', { endpoint: 'https://x' }],
    ['thiếu auth', { endpoint: 'https://x', keys: { p256dh: 'a' } }],
  ])('FR-01: %s -> ném INVALID_SUBSCRIPTION (không gửi dữ liệu hỏng lên server)', (_label, json) => {
    const broken = makeSubscription(KEY_A_BYTES, { toJSON: () => json as PushSubscriptionJSON });
    expect(() => toSubscriptionBody(broken as unknown as PushSubscription)).toThrow(PushClientError);
  });
});

describe('unsubscribeLocalPush (FR-01)', () => {
  it('FR-01: có subscription thì hủy và trả true', async () => {
    const setup = setupBrowser();
    const existing = makeSubscription();
    setup.registration!.pushManager.getSubscription.mockResolvedValue(existing);
    expect(await unsubscribeLocalPush()).toBe(true);
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('FR-01: không có subscription hoặc không có service worker thì trả false, không ném', async () => {
    setupBrowser();
    expect(await unsubscribeLocalPush()).toBe(false);
    setupBrowser({ hasRegistration: false });
    expect(await unsubscribeLocalPush()).toBe(false);
  });
});
