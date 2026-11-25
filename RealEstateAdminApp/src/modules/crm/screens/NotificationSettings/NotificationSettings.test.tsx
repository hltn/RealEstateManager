import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmApiException } from '@crm/api/http/crmErrors';
import type { PushDevice, PushRevokedDevice, PushSubscriptionList } from '@crm/api/http/pushApi';
import type { PushDeviceState } from '../../../../pwa/pushDeviceState';
import { PUSH_SUBSCRIPTION_ID_KEY, readPushSubscriptionId } from '../../../../pwa/pushStorage';
import NotificationSettingsScreen from './index';
import { buildDisplacedNotices } from './useNotificationSettings';

const fetchPushConfig = vi.fn();
const fetchPushSubscriptions = vi.fn();
const registerPushSubscription = vi.fn();
const deletePushSubscription = vi.fn();
vi.mock('@crm/api/http/pushApi', () => ({
  fetchPushConfig: (...args: unknown[]) => fetchPushConfig(...args),
  fetchPushSubscriptions: (...args: unknown[]) => fetchPushSubscriptions(...args),
  registerPushSubscription: (...args: unknown[]) => registerPushSubscription(...args),
  deletePushSubscription: (...args: unknown[]) => deletePushSubscription(...args),
}));

// Khối loại thông báo/giờ yên lặng (T-42) có file test riêng; ở đây chỉ chặn mạng thật.
vi.mock('@crm/api/http/notificationPreferencesApi', () => ({
  fetchNotificationPreferences: () => Promise.resolve({ types: {}, quietHours: null, pushTypes: [] }),
  updateNotificationPreferences: () => Promise.resolve({ types: {}, quietHours: null, pushTypes: [] }),
}));

const readDeviceSnapshot = vi.fn();
const enablePush = vi.fn();
const unsubscribeLocalPush = vi.fn();
vi.mock('../../../../pwa/pushClient', async () => {
  const real = await vi.importActual<typeof import('../../../../pwa/pushClient')>('../../../../pwa/pushClient');
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
  }) as unknown as PushSubscription;

const makeDevice = (id: string, deviceLabel: string): PushDevice => ({ id, deviceLabel, platform: 'ANDROID', lastSeenAt: '2026-11-07T03:00:00.000Z', createdAt: '2026-10-01T03:00:00.000Z' });

const makeList = (active: PushDevice[] = [], recentlyRevoked: PushRevokedDevice[] = []): PushSubscriptionList => ({ active, recentlyRevoked });

const setDeviceState = (state: PushDeviceState, withSubscription = false) =>
  readDeviceSnapshot.mockResolvedValue({ state, subscription: withSubscription ? makeSubscription() : null });

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationSettingsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const thisDeviceBlock = () => screen.getByRole('region', { name: 'Thiết bị này' });
const deviceListBlock = () => screen.getByRole('region', { name: 'Thiết bị của bạn' });

beforeEach(() => {
  for (const mock of [fetchPushConfig, fetchPushSubscriptions, registerPushSubscription, deletePushSubscription, readDeviceSnapshot, enablePush, unsubscribeLocalPush]) mock.mockReset();
  localStorage.clear();
  fetchPushConfig.mockResolvedValue({ enabled: true, publicKey: 'AQID' });
  fetchPushSubscriptions.mockResolvedValue(makeList());
  unsubscribeLocalPush.mockResolvedValue(true);
  deletePushSubscription.mockResolvedValue(undefined);
  setDeviceState('ready');
});

describe('Cài đặt thông báo: khối "Thiết bị này" theo trạng thái (FR-09)', () => {
  it('FR-09: ready và máy chủ bật push thì có nút "Bật thông báo"; không tự xin quyền khi mở trang', async () => {
    renderScreen();
    expect(await within(await screen.findByRole('region', { name: 'Thiết bị này' })).findByRole('button', { name: /Bật thông báo/ })).toBeEnabled();
    expect(enablePush).not.toHaveBeenCalled();
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  it('FR-09: iPhone chưa cài (needs-install) thì KHÔNG có nút, hiện hướng dẫn "Thêm vào MH chính"', async () => {
    setDeviceState('needs-install');
    renderScreen();
    await waitFor(() => expect(thisDeviceBlock()).toHaveTextContent('Thêm vào MH chính'));
    expect(within(thisDeviceBlock()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('FR-09: quyền bị chặn (blocked) thì không có nút, hướng dẫn mở lại quyền', async () => {
    setDeviceState('blocked');
    renderScreen();
    await waitFor(() => expect(thisDeviceBlock()).toHaveTextContent('Bạn đã chặn thông báo'));
    expect(within(thisDeviceBlock()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('FR-09: trình duyệt không hỗ trợ (unsupported) thì báo không hỗ trợ, không có nút', async () => {
    setDeviceState('unsupported');
    renderScreen();
    await waitFor(() => expect(thisDeviceBlock()).toHaveTextContent('chưa hỗ trợ thông báo đẩy'));
    expect(within(thisDeviceBlock()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('FR-09: máy chủ chưa bật push (enabled = false) thì KHÔNG hiện nút Bật dù thiết bị ready', async () => {
    fetchPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    renderScreen();
    await waitFor(() => expect(thisDeviceBlock()).toHaveTextContent('chưa được bật trên hệ thống'));
    expect(within(thisDeviceBlock()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('FR-09: đang xác định thì hiện khung chờ, không nháy "chưa bật trên hệ thống"', async () => {
    fetchPushConfig.mockReturnValue(new Promise(() => undefined));
    renderScreen();
    expect(await screen.findByLabelText('Đang kiểm tra thiết bị')).toBeInTheDocument();
    expect(thisDeviceBlock()).not.toHaveTextContent('chưa được bật trên hệ thống');
  });
});

describe('Cài đặt thông báo: bật/tắt thiết bị này (FR-09, FR-01)', () => {
  it('FR-09: bấm "Bật thông báo" thì xin quyền bằng khóa từ API, đăng ký lên máy chủ và làm tươi danh sách thiết bị', async () => {
    enablePush.mockResolvedValue({ subscription: makeSubscription(), isNew: true });
    registerPushSubscription.mockResolvedValue({ id: 'sub-1', deviceLabel: 'Chrome · Android', platform: 'ANDROID', createdAt: '', lastSeenAt: '', displaced: null });
    renderScreen();
    await screen.findByText('Chưa có thiết bị nào bật thông báo.');
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('sub-1', 'Chrome · Android')]));

    await userEvent.click(await screen.findByRole('button', { name: /Bật thông báo/ }));

    await waitFor(() => expect(registerPushSubscription).toHaveBeenCalledTimes(1));
    expect(enablePush).toHaveBeenCalledWith('AQID');
    expect(readPushSubscriptionId()).toBe('sub-1');
    expect(await within(deviceListBlock()).findByText('Chrome · Android')).toBeInTheDocument();
  });

  it('FR-09: người dùng từ chối quyền thì hiện lỗi tiếng Việt, không đăng ký lên máy chủ', async () => {
    const { PushClientError } = await vi.importActual<typeof import('../../../../pwa/pushClient')>('../../../../pwa/pushClient');
    enablePush.mockRejectedValue(new PushClientError('PERMISSION_NOT_GRANTED', 'Chưa được cấp quyền thông báo.'));
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: /Bật thông báo/ }));

    expect(await within(thisDeviceBlock()).findByRole('alert')).toHaveTextContent('Chưa được cấp quyền thông báo.');
    expect(registerPushSubscription).not.toHaveBeenCalled();
  });

  it('FR-09: thiết bị đang bật thì hiện nút "Tắt thông báo" (kể cả khi máy chủ đã tắt push); bấm tắt thì gỡ ở máy chủ và ở trình duyệt', async () => {
    fetchPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    setDeviceState('subscribed', true);
    localStorage.setItem(PUSH_SUBSCRIPTION_ID_KEY, 'sub-1');
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('sub-1', 'Chrome · Android')]));
    renderScreen();
    await within(deviceListBlock()).findByText('Chrome · Android');
    fetchPushSubscriptions.mockResolvedValue(makeList());
    setDeviceState('ready');

    await userEvent.click(await screen.findByRole('button', { name: /Tắt thông báo/ }));

    await waitFor(() => expect(deletePushSubscription).toHaveBeenCalledWith('sub-1'));
    expect(unsubscribeLocalPush).toHaveBeenCalledTimes(1);
    expect(readPushSubscriptionId()).toBeNull();
    expect(await screen.findByText('Chưa có thiết bị nào bật thông báo.')).toBeInTheDocument();
  });
});

describe('Cài đặt thông báo: danh sách thiết bị (FR-01, FR-09)', () => {
  it('FR-01: hiện thiết bị đang bật, đánh dấu "Thiết bị này" đúng thiết bị có id đã lưu', async () => {
    localStorage.setItem(PUSH_SUBSCRIPTION_ID_KEY, 'd2');
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('d1', 'iPhone · Safari'), makeDevice('d2', 'Chrome · Android')]));
    renderScreen();

    const items = within(await within(deviceListBlock()).findByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('iPhone · Safari');
    expect(items[0]).not.toHaveTextContent('Thiết bị này');
    expect(items[1]).toHaveTextContent('Chrome · Android');
    expect(items[1]).toHaveTextContent('Thiết bị này');
  });

  it('FR-09: thiết bị bị gỡ vì vượt giới hạn hiện thông báo "Đã gỡ … để nhường chỗ"; lý do khác (USER, GONE) không hiện', async () => {
    fetchPushSubscriptions.mockResolvedValue(
      makeList([makeDevice('d1', 'Chrome · Android')], [
        { deviceLabel: 'iPhone · Safari', reason: 'LIMIT_EXCEEDED', revokedAt: '2026-11-06T03:00:00.000Z' },
        { deviceLabel: 'Firefox · Windows', reason: 'USER', revokedAt: '2026-11-06T03:00:00.000Z' },
        { deviceLabel: 'Edge · Windows', reason: 'GONE', revokedAt: '2026-11-06T03:00:00.000Z' },
      ]),
    );
    renderScreen();

    const notice = await within(deviceListBlock()).findByRole('status');
    expect(notice).toHaveTextContent('Đã gỡ iPhone · Safari để nhường chỗ');
    expect(notice).not.toHaveTextContent('Firefox');
    expect(notice).not.toHaveTextContent('Edge');
  });

  it('FR-01: gỡ một thiết bị khác thì gọi DELETE đúng id, danh sách tải lại và thiết bị biến mất', async () => {
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('d1', 'iPhone · Safari'), makeDevice('d2', 'Chrome · Android')]));
    renderScreen();
    await within(deviceListBlock()).findByText('iPhone · Safari');
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('d2', 'Chrome · Android')]));

    await userEvent.click(screen.getByRole('button', { name: 'Gỡ thiết bị iPhone · Safari' }));

    await waitFor(() => expect(deletePushSubscription).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(screen.queryByText('iPhone · Safari')).not.toBeInTheDocument());
    expect(screen.getByText('Chrome · Android')).toBeInTheDocument();
    expect(unsubscribeLocalPush).not.toHaveBeenCalled();
  });

  it('FR-01: gỡ chính thiết bị này từ danh sách thì cũng hủy đăng ký ở trình duyệt và quên id đã lưu', async () => {
    localStorage.setItem(PUSH_SUBSCRIPTION_ID_KEY, 'd1');
    setDeviceState('subscribed', true);
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('d1', 'Chrome · Android')]));
    renderScreen();
    await within(deviceListBlock()).findByText('Chrome · Android');

    await userEvent.click(screen.getByRole('button', { name: 'Gỡ thiết bị Chrome · Android' }));

    await waitFor(() => expect(deletePushSubscription).toHaveBeenCalledWith('d1'));
    expect(unsubscribeLocalPush).toHaveBeenCalledTimes(1);
    expect(readPushSubscriptionId()).toBeNull();
  });

  it('FR-01: gỡ thiết bị lỗi thì báo lỗi tiếng Việt và thiết bị vẫn còn trong danh sách', async () => {
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('d1', 'iPhone · Safari')]));
    deletePushSubscription.mockRejectedValue(new CrmApiException({ statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message: 'Hệ thống đang bận hoặc đang bảo trì. Vui lòng thử lại sau ít phút.' }));
    renderScreen();
    await within(deviceListBlock()).findByText('iPhone · Safari');

    await userEvent.click(screen.getByRole('button', { name: 'Gỡ thiết bị iPhone · Safari' }));

    expect(await within(deviceListBlock()).findByRole('alert')).toHaveTextContent('Hệ thống đang bận');
    expect(screen.getByText('iPhone · Safari')).toBeInTheDocument();
  });

  it('FR-01: chưa có thiết bị nào thì hiện trạng thái rỗng', async () => {
    renderScreen();
    expect(await screen.findByText('Chưa có thiết bị nào bật thông báo.')).toBeInTheDocument();
  });

  it('FR-01: tải danh sách lỗi thì hiện lỗi kèm "Thử lại", bấm thì tải lại được', async () => {
    fetchPushSubscriptions.mockRejectedValueOnce(new CrmApiException({ statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message: 'Hệ thống đang bận hoặc đang bảo trì. Vui lòng thử lại sau ít phút.' }));
    renderScreen();
    expect(await within(deviceListBlock()).findByRole('alert')).toHaveTextContent('Hệ thống đang bận');
    fetchPushSubscriptions.mockResolvedValue(makeList([makeDevice('d1', 'iPhone · Safari')]));

    await userEvent.click(within(deviceListBlock()).getByRole('button', { name: 'Thử lại' }));

    expect(await within(deviceListBlock()).findByText('iPhone · Safari')).toBeInTheDocument();
  });

  it('FR-01: có liên kết quay lại màn Thông báo', async () => {
    renderScreen();
    expect(await screen.findByRole('link', { name: /Quay lại Thông báo/ })).toHaveAttribute('href', '/notifications');
  });
});

describe('buildDisplacedNotices (FR-09)', () => {
  it('FR-09: chỉ giữ lý do LIMIT_EXCEEDED, nhắc giới hạn 3 thiết bị', () => {
    const revoked: PushRevokedDevice[] = [
      { deviceLabel: 'A', reason: 'LIMIT_EXCEEDED', revokedAt: '2026-11-06T00:00:00.000Z' },
      { deviceLabel: 'B', reason: 'LOGOUT', revokedAt: '2026-11-06T00:00:00.000Z' },
      { deviceLabel: 'C', reason: 'ACCOUNT_DISABLED', revokedAt: '2026-11-06T00:00:00.000Z' },
    ];
    expect(buildDisplacedNotices(revoked)).toEqual(['Đã gỡ A để nhường chỗ (tối đa 3 thiết bị).']);
    expect(buildDisplacedNotices([])).toEqual([]);
  });
});
