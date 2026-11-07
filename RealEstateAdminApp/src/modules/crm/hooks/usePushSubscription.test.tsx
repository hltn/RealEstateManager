import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_REFRESH_INTERVAL_MS, type PushDeviceState } from '../../../pwa/pushDeviceState';
import { PUSH_LAST_REFRESH_KEY, PUSH_SUBSCRIPTION_ID_KEY, readPushSubscriptionId, savePushRegistration } from '../../../pwa/pushStorage';
import { CrmApiException } from '@crm/api/http/crmErrors';
import { refreshPushSubscriptionIfDue, usePushSubscription } from './usePushSubscription';

const fetchPushConfig = vi.fn();
const registerPushSubscription = vi.fn();
const deletePushSubscription = vi.fn();
vi.mock('@crm/api/http/pushApi', () => ({
  fetchPushConfig: (...args: unknown[]) => fetchPushConfig(...args),
  registerPushSubscription: (...args: unknown[]) => registerPushSubscription(...args),
  deletePushSubscription: (...args: unknown[]) => deletePushSubscription(...args),
}));

const readDeviceSnapshot = vi.fn();
const enablePush = vi.fn();
const unsubscribeLocalPush = vi.fn();
vi.mock('../../../pwa/pushClient', async () => {
  const real = await vi.importActual<typeof import('../../../pwa/pushClient')>('../../../pwa/pushClient');
  return {
    ...real,
    readDeviceSnapshot: (...args: unknown[]) => readDeviceSnapshot(...args),
    enablePush: (...args: unknown[]) => enablePush(...args),
    unsubscribeLocalPush: (...args: unknown[]) => unsubscribeLocalPush(...args),
  };
});

const makeSubscription = () =>
  ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'P256', auth: 'AUTH' } }),
  }) as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };

const makeRegistration = (id = 'sub-1', displaced: { id: string; deviceLabel: string } | null = null) => ({
  id,
  deviceLabel: 'Chrome · Android',
  platform: 'android',
  createdAt: '2026-11-07T00:00:00.000Z',
  lastSeenAt: '2026-11-07T00:00:00.000Z',
  displaced,
});

const snapshotOf = (state: PushDeviceState, subscription: PushSubscription | null = null) => ({ state, subscription });

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper };
};

const renderPushHook = () => renderHook(() => usePushSubscription(), { wrapper: createWrapper().wrapper });

beforeEach(() => {
  fetchPushConfig.mockReset();
  registerPushSubscription.mockReset();
  deletePushSubscription.mockReset();
  readDeviceSnapshot.mockReset();
  enablePush.mockReset();
  unsubscribeLocalPush.mockReset();
  localStorage.clear();
  fetchPushConfig.mockResolvedValue({ enabled: true, publicKey: 'AQID' });
  readDeviceSnapshot.mockResolvedValue(snapshotOf('ready'));
  unsubscribeLocalPush.mockResolvedValue(true);
  deletePushSubscription.mockResolvedValue(undefined);
});

describe('usePushSubscription: trạng thái thiết bị và nút (FR-09)', () => {
  it('FR-09: iPhone chưa cài (needs-install) thì không có nút Bật dù server bật push', async () => {
    readDeviceSnapshot.mockResolvedValue(snapshotOf('needs-install'));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.state).toBe('needs-install'));
    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    expect(result.current.canEnable).toBe(false);
    expect(result.current.canDisable).toBe(false);
  });

  it('FR-09: quyền bị chặn (blocked) thì không có nút Bật, không xin lại quyền', async () => {
    readDeviceSnapshot.mockResolvedValue(snapshotOf('blocked'));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.state).toBe('blocked'));
    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    expect(result.current.canEnable).toBe(false);
    expect(enablePush).not.toHaveBeenCalled();
  });

  it('FR-09: unsupported thì không có nút nào', async () => {
    readDeviceSnapshot.mockResolvedValue(snapshotOf('unsupported'));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.state).toBe('unsupported'));
    expect(result.current.canEnable).toBe(false);
    expect(result.current.canDisable).toBe(false);
  });

  it('FR-09: ready và server bật push thì có nút Bật; KHÔNG tự xin quyền hay đăng ký khi mount', async () => {
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canEnable).toBe(true));
    expect(result.current.state).toBe('ready');
    expect(enablePush).not.toHaveBeenCalled();
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  it('FR-09: ready nhưng server tắt push (enabled = false) thì KHÔNG có nút Bật', async () => {
    fetchPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await waitFor(() => expect(fetchPushConfig).toHaveBeenCalled());
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.canEnable).toBe(false);
  });

  it('FR-09: subscribed thì có nút Tắt, kể cả khi server đã tắt push', async () => {
    fetchPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canDisable).toBe(true));
    expect(result.current.canEnable).toBe(false);
  });
});

describe('usePushSubscription: bật thông báo (FR-09, FR-01)', () => {
  it('FR-09: enable xin quyền bằng khóa lấy lúc chạy từ API, POST đăng ký, lưu id và trả displaced', async () => {
    const subscription = makeSubscription();
    enablePush.mockResolvedValue({ subscription, isNew: true });
    registerPushSubscription.mockResolvedValue(makeRegistration('sub-9', { id: 'old', deviceLabel: 'iPhone · Safari' }));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canEnable).toBe(true));

    let registration: Awaited<ReturnType<typeof result.current.enable>> = null;
    await act(async () => {
      registration = await result.current.enable();
    });

    expect(enablePush).toHaveBeenCalledWith('AQID');
    expect(registerPushSubscription).toHaveBeenCalledWith({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P256', auth: 'AUTH' }, expirationTime: null });
    expect(readPushSubscriptionId()).toBe('sub-9');
    expect(localStorage.getItem(PUSH_LAST_REFRESH_KEY)).not.toBeNull();
    expect(registration).toMatchObject({ id: 'sub-9', displaced: { deviceLabel: 'iPhone · Safari' } });
    expect(result.current.error).toBeNull();
  });

  it('FR-09: enable khi server chưa bật push thì không xin quyền, báo lỗi', async () => {
    fetchPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    const { result } = renderPushHook();
    await waitFor(() => expect(fetchPushConfig).toHaveBeenCalled());
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      await result.current.enable();
    });

    expect(enablePush).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Thông báo đẩy chưa được bật trên hệ thống.');
  });

  it('FR-09: người dùng từ chối quyền thì trả null, báo lỗi, không POST', async () => {
    const { PushClientError } = await vi.importActual<typeof import('../../../pwa/pushClient')>('../../../pwa/pushClient');
    enablePush.mockRejectedValue(new PushClientError('PERMISSION_NOT_GRANTED', 'Chưa được cấp quyền thông báo.'));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canEnable).toBe(true));

    await act(async () => {
      expect(await result.current.enable()).toBeNull();
    });

    expect(registerPushSubscription).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Chưa được cấp quyền thông báo.');
    expect(result.current.isBusy).toBe(false);
  });

  it('FR-01: server từ chối POST thì hủy subscription vừa tạo (không để mồ côi) và không lưu id', async () => {
    const subscription = makeSubscription();
    enablePush.mockResolvedValue({ subscription, isNew: true });
    registerPushSubscription.mockRejectedValue(new CrmApiException({ statusCode: 400, errorCode: 'PUSH_SUBSCRIPTION_INVALID', message: 'Đăng ký không hợp lệ.' }));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canEnable).toBe(true));

    await act(async () => {
      expect(await result.current.enable()).toBeNull();
    });

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(readPushSubscriptionId()).toBeNull();
    expect(result.current.error).toBe('Đăng ký không hợp lệ.');
  });

  it('FR-01: server từ chối POST nhưng subscription là bản cũ dùng lại thì KHÔNG hủy nó', async () => {
    const subscription = makeSubscription();
    enablePush.mockResolvedValue({ subscription, isNew: false });
    registerPushSubscription.mockRejectedValue(new CrmApiException({ statusCode: 500, errorCode: 'INTERNAL_ERROR', message: 'Lỗi' }));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canEnable).toBe(true));

    await act(async () => {
      await result.current.enable();
    });

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('usePushSubscription: làm tươi tối đa 1 lần/24 giờ (FR-09)', () => {
  it('FR-09: subscribed, chưa từng làm tươi thì POST đúng 1 lần và ghi mốc', async () => {
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    registerPushSubscription.mockResolvedValue(makeRegistration('sub-1'));
    renderPushHook();
    await waitFor(() => expect(registerPushSubscription).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readPushSubscriptionId()).toBe('sub-1'));
  });

  it('FR-09: subscribed, mới làm tươi chưa đủ 24 giờ thì KHÔNG POST', async () => {
    savePushRegistration('sub-1', Date.now() - 60 * 60 * 1000);
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.state).toBe('subscribed'));
    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    // Khóa truy vấn đổi khi biết cờ bật: đợi lần đọc thứ hai (lần có quyền làm tươi) chạy xong rồi mới khẳng định không POST.
    await waitFor(() => expect(readDeviceSnapshot).toHaveBeenCalledTimes(2));
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  it('FR-09: subscribed, đã quá 24 giờ thì POST lại', async () => {
    savePushRegistration('sub-1', Date.now() - PUSH_REFRESH_INTERVAL_MS - 1000);
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    registerPushSubscription.mockResolvedValue(makeRegistration('sub-1'));
    renderPushHook();
    await waitFor(() => expect(registerPushSubscription).toHaveBeenCalledTimes(1));
  });

  it('FR-09: server tắt push (enabled = false) thì không làm tươi dù đã subscribed', async () => {
    fetchPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.state).toBe('subscribed'));
    await waitFor(() => expect(fetchPushConfig).toHaveBeenCalled());
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  it('FR-09: ready (chưa bật) thì không POST làm tươi', async () => {
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canEnable).toBe(true));
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  it('FR-09: refreshPushSubscriptionIfDue có id nhưng mất mốc thời gian thì vẫn làm tươi; lỗi POST không ném và không ghi mốc', async () => {
    localStorage.setItem(PUSH_SUBSCRIPTION_ID_KEY, 'sub-1');
    registerPushSubscription.mockRejectedValue(new Error('network'));
    await expect(refreshPushSubscriptionIfDue(makeSubscription())).resolves.toBeUndefined();
    expect(registerPushSubscription).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_LAST_REFRESH_KEY)).toBeNull();
  });

  it('FR-09: refreshPushSubscriptionIfDue mất id đã lưu (localStorage bị xóa) thì làm tươi để lấy lại id dù mốc còn mới', async () => {
    localStorage.setItem(PUSH_LAST_REFRESH_KEY, String(Date.now()));
    registerPushSubscription.mockResolvedValue(makeRegistration('sub-7'));
    await refreshPushSubscriptionIfDue(makeSubscription());
    expect(readPushSubscriptionId()).toBe('sub-7');
  });
});

describe('usePushSubscription: tắt thông báo (FR-01)', () => {
  it('FR-01: disable gỡ ở server theo id đã lưu, hủy ở trình duyệt và xóa bản ghi cục bộ', async () => {
    savePushRegistration('sub-1', Date.now());
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canDisable).toBe(true));

    await act(async () => {
      expect(await result.current.disable()).toBe(true);
    });

    expect(deletePushSubscription).toHaveBeenCalledWith('sub-1');
    expect(unsubscribeLocalPush).toHaveBeenCalledTimes(1);
    expect(readPushSubscriptionId()).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('FR-01: server lỗi khi gỡ thì VẪN tắt ở trình duyệt, xóa bản ghi và báo cho người dùng', async () => {
    savePushRegistration('sub-1', Date.now());
    deletePushSubscription.mockRejectedValue(new Error('network'));
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canDisable).toBe(true));

    await act(async () => {
      expect(await result.current.disable()).toBe(true);
    });

    expect(unsubscribeLocalPush).toHaveBeenCalledTimes(1);
    expect(readPushSubscriptionId()).toBeNull();
    expect(result.current.error).toContain('chưa gỡ được ở máy chủ');
  });

  it('FR-01: không có id đã lưu thì không gọi DELETE nhưng vẫn hủy ở trình duyệt', async () => {
    readDeviceSnapshot.mockResolvedValue(snapshotOf('subscribed', makeSubscription()));
    const { result } = renderPushHook();
    await waitFor(() => expect(result.current.canDisable).toBe(true));

    await act(async () => {
      await result.current.disable();
    });

    expect(deletePushSubscription).not.toHaveBeenCalled();
    expect(unsubscribeLocalPush).toHaveBeenCalledTimes(1);
  });
});
