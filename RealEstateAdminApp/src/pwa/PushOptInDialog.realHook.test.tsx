import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth.store';
import PushOptInDialog from './PushOptInDialog';
import { PUSH_OPT_IN_CHOICE_KEY } from './pushOptInStorage';

// Dùng hook `usePushSubscription` THẬT; chỉ giả lớp mạng (pushApi) và phần chạm trình duyệt (pushClient), như usePushSubscription.test.tsx.
const fetchPushConfig = vi.fn();
const registerPushSubscription = vi.fn();
vi.mock('@crm/api/http/pushApi', () => ({
  fetchPushConfig: (...args: unknown[]) => fetchPushConfig(...args),
  registerPushSubscription: (...args: unknown[]) => registerPushSubscription(...args),
  deletePushSubscription: vi.fn(),
}));

const readDeviceSnapshot = vi.fn();
const enablePush = vi.fn();
vi.mock('./pushClient', async () => {
  const real = await vi.importActual<typeof import('./pushClient')>('./pushClient');
  return {
    ...real,
    readDeviceSnapshot: (...args: unknown[]) => readDeviceSnapshot(...args),
    enablePush: (...args: unknown[]) => enablePush(...args),
  };
});

const DIALOG = { name: 'Bật thông báo cho STND?' };
const ENABLE_BUTTON = { name: 'Bật thông báo' };

const makeSubscription = () =>
  ({
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'P256', auth: 'AUTH' } }),
  }) as unknown as PushSubscription;

const setPermission = (permission: 'default' | 'granted' | 'denied') => Object.defineProperty(window, 'Notification', { value: { permission }, configurable: true, writable: true });

const renderDialog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PushOptInDialog />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'STAFF' }, isInitialized: true });
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  setPermission('default');
  fetchPushConfig.mockReset().mockResolvedValue({ enabled: true, publicKey: 'AQID' });
  registerPushSubscription.mockReset();
  readDeviceSnapshot.mockReset().mockResolvedValue({ state: 'ready', subscription: null });
  enablePush.mockReset();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'standalone');
  Reflect.deleteProperty(window, 'Notification');
});

/** Trình duyệt cấp quyền (permission -> granted) rồi tạo subscription; chỉ bước đăng ký lên server là do từng test quyết định. */
const grantOnEnable = () =>
  enablePush.mockImplementation(async () => {
    setPermission('granted');
    return { subscription: makeSubscription(), isNew: true };
  });

describe('PushOptInDialog với usePushSubscription thật (FR-28)', () => {
  it('đã cấp quyền nhưng POST server lỗi: hộp vẫn mở, hiện lỗi (role=alert), chưa ghi khóa; "Để sau" mới ghi skipped', async () => {
    grantOnEnable();
    registerPushSubscription.mockRejectedValue(new Error('server down'));
    renderDialog();

    await userEvent.click(await screen.findByRole('button', ENABLE_BUTTON));

    // Quyền đã là granted (đọc lại sẽ không còn đủ điều kiện), nhưng hộp phải giữ mở để người dùng biết chưa bật được.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('dialog', DIALOG)).toBeInTheDocument();
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBeNull();
    expect(enablePush).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('skipped');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lỗi server rồi bấm "Bật" lại và thành công: ghi enabled và đóng hộp', async () => {
    grantOnEnable();
    registerPushSubscription.mockRejectedValueOnce(new Error('server down')).mockResolvedValueOnce({ id: 'sub-1', displaced: null });
    renderDialog();

    await userEvent.click(await screen.findByRole('button', ENABLE_BUTTON));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', ENABLE_BUTTON));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY)).toBe('enabled');
  });

  it('quyền đã granted TỪ TRƯỚC khi mở app: không hiện hộp và không gọi API cấu hình', async () => {
    setPermission('granted');
    renderDialog();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchPushConfig).not.toHaveBeenCalled();
  });
});
