/**
 * T-42 (FR-10, FR-43): công tắc "Thông báo đẩy" theo `pushTypes` và khối "Giờ yên lặng" của trang Cài đặt thông báo.
 * Mock lớp API (`notificationPreferencesApi`) và phần PWA; kiểm hành vi người dùng thấy + thân `PUT` gửi đi.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmApiException } from '@crm/api/http/crmErrors';
import type { NotificationPreferences, PushTypeInfo, UpdateNotificationPreferencesBody } from '@crm/api/http/notificationPreferencesApi';
import NotificationSettingsScreen from './index';
import { isOvernight, isSameQuietHours, validateQuietHours } from './quietHours';

const fetchNotificationPreferences = vi.fn();
const updateNotificationPreferences = vi.fn();
vi.mock('@crm/api/http/notificationPreferencesApi', () => ({
  fetchNotificationPreferences: (...args: unknown[]) => fetchNotificationPreferences(...args),
  updateNotificationPreferences: (...args: unknown[]) => updateNotificationPreferences(...args),
}));

// Phần thiết bị (T-41) không thuộc file này: chặn mạng/PWA thật.
vi.mock('@crm/api/http/pushApi', () => ({
  fetchPushConfig: () => Promise.resolve({ enabled: false, publicKey: null }),
  fetchPushSubscriptions: () => Promise.resolve({ active: [], recentlyRevoked: [] }),
  registerPushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
}));
vi.mock('../../../../pwa/pushClient', async () => {
  const real = await vi.importActual<typeof import('../../../../pwa/pushClient')>('../../../../pwa/pushClient');
  return { ...real, readDeviceSnapshot: () => Promise.resolve({ state: 'unsupported', subscription: null }) };
});

const makePushType = (type: string, label: string, overrides: Partial<PushTypeInfo> = {}): PushTypeInfo => ({
  type,
  label,
  description: `Mô tả ${label}`,
  defaultEnabled: true,
  canDisable: true,
  ...overrides,
});

/** Danh mục giả có tên KHÁC bản thật để chứng minh giao diện lấy nhãn từ `pushTypes`, không hard-code. */
const PUSH_TYPES = [makePushType('TYPE_A', 'Loại thử A'), makePushType('TYPE_B', 'Loại thử B')];

const makePrefs = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  types: { TYPE_A: { push: true, inApp: true }, TYPE_B: { push: true, inApp: true } },
  quietHours: null,
  pushTypes: PUSH_TYPES,
  ...overrides,
});

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

const typesBlock = () => screen.getByRole('region', { name: 'Loại thông báo' });
const quietBlock = () => screen.getByRole('region', { name: 'Giờ yên lặng' });
const pushSwitch = (label: string) => within(typesBlock()).getByRole('switch', { name: label });

beforeEach(() => {
  fetchNotificationPreferences.mockReset();
  updateNotificationPreferences.mockReset();
  fetchNotificationPreferences.mockResolvedValue(makePrefs());
  updateNotificationPreferences.mockImplementation((body: UpdateNotificationPreferencesBody) => Promise.resolve({ ...makePrefs(), quietHours: body.quietHours ?? null }));
});

describe('Cài đặt thông báo: công tắc "Thông báo đẩy" theo pushTypes (FR-10, FR-43)', () => {
  it('FR-43: render đúng từng loại trong pushTypes (nhãn, mô tả từ máy chủ), không hard-code danh sách', async () => {
    renderScreen();
    expect(await within(await screen.findByRole('region', { name: 'Loại thông báo' })).findByRole('switch', { name: 'Loại thử A' })).toBeChecked();
    expect(pushSwitch('Loại thử B')).toBeChecked();
    expect(within(typesBlock()).getAllByRole('switch')).toHaveLength(2);
    expect(typesBlock()).toHaveTextContent('Mô tả Loại thử A');
  });

  it('FR-43: danh mục thêm loại mới thì trang tự có thêm công tắc (không sửa FE)', async () => {
    fetchNotificationPreferences.mockResolvedValue(
      makePrefs({ pushTypes: [...PUSH_TYPES, makePushType('TYPE_C', 'Loại thử C')], types: { TYPE_A: { push: true, inApp: true }, TYPE_C: { push: false, inApp: true } } }),
    );
    renderScreen();
    expect(await within(await screen.findByRole('region', { name: 'Loại thông báo' })).findByRole('switch', { name: 'Loại thử C' })).not.toBeChecked();
  });

  it('FR-10: tắt một loại thì cập nhật ngay (optimistic) và PUT chỉ gửi loại đó, giữ nguyên inApp', async () => {
    fetchNotificationPreferences.mockResolvedValue(makePrefs({ types: { TYPE_A: { push: true, inApp: true }, TYPE_B: { push: true, inApp: true } } }));
    let resolveSave: (value: NotificationPreferences) => void = () => undefined;
    updateNotificationPreferences.mockReturnValue(new Promise<NotificationPreferences>((resolve) => (resolveSave = resolve)));
    renderScreen();
    await screen.findByRole('switch', { name: 'Loại thử A' });

    await userEvent.click(pushSwitch('Loại thử A'));

    // Máy chủ chưa trả lời mà công tắc đã tắt.
    expect(pushSwitch('Loại thử A')).not.toBeChecked();
    expect(updateNotificationPreferences).toHaveBeenCalledWith({ types: { TYPE_A: { push: false, inApp: true } } });
    expect(pushSwitch('Loại thử B')).toBeChecked();
    resolveSave(makePrefs({ types: { TYPE_A: { push: false, inApp: true }, TYPE_B: { push: true, inApp: true } } }));
    await waitFor(() => expect(pushSwitch('Loại thử A')).not.toBeChecked());
  });

  it('FR-10: bật lại một loại đang tắt thì PUT push = true', async () => {
    fetchNotificationPreferences.mockResolvedValue(makePrefs({ types: { TYPE_A: { push: false, inApp: true }, TYPE_B: { push: true, inApp: true } } }));
    renderScreen();
    await screen.findByRole('switch', { name: 'Loại thử A' });
    expect(pushSwitch('Loại thử A')).not.toBeChecked();

    await userEvent.click(pushSwitch('Loại thử A'));

    expect(updateNotificationPreferences).toHaveBeenCalledWith({ types: { TYPE_A: { push: true, inApp: true } } });
  });

  it('FR-10: lưu lỗi thì hoàn tác công tắc đó, báo lỗi tiếng Việt, không đổi công tắc khác', async () => {
    updateNotificationPreferences.mockRejectedValue(new CrmApiException({ statusCode: 500, message: 'Không lưu được cài đặt', errorCode: 'INTERNAL' }));
    renderScreen();
    await screen.findByRole('switch', { name: 'Loại thử A' });

    await userEvent.click(pushSwitch('Loại thử A'));

    expect(await screen.findByText('Không lưu được cài đặt')).toBeInTheDocument();
    await waitFor(() => expect(pushSwitch('Loại thử A')).toBeChecked());
    expect(pushSwitch('Loại thử B')).toBeChecked();
  });

  it('FR-10: lỗi của một lần lưu không làm mất lần lưu thành công của loại khác khi bấm liên tiếp', async () => {
    updateNotificationPreferences.mockImplementation((body: UpdateNotificationPreferencesBody) =>
      'TYPE_A' in body.types
        ? Promise.reject(new CrmApiException({ statusCode: 500, message: 'Lỗi A', errorCode: 'INTERNAL' }))
        : Promise.resolve(makePrefs({ types: { TYPE_A: { push: true, inApp: true }, TYPE_B: { push: false, inApp: true } } })),
    );
    // Lần tải lại sau khi lưu phản ánh đúng trạng thái máy chủ: A giữ nguyên, B đã tắt.
    fetchNotificationPreferences.mockResolvedValueOnce(makePrefs()).mockResolvedValue(makePrefs({ types: { TYPE_A: { push: true, inApp: true }, TYPE_B: { push: false, inApp: true } } }));
    renderScreen();
    await screen.findByRole('switch', { name: 'Loại thử A' });

    await userEvent.click(pushSwitch('Loại thử A'));
    await userEvent.click(pushSwitch('Loại thử B'));

    await waitFor(() => expect(pushSwitch('Loại thử A')).toBeChecked());
    await waitFor(() => expect(pushSwitch('Loại thử B')).not.toBeChecked());
  });

  it('FR-43: loại canDisable = false thì công tắc bị khóa, không gọi PUT', async () => {
    fetchNotificationPreferences.mockResolvedValue(makePrefs({ pushTypes: [makePushType('TYPE_A', 'Loại thử A', { canDisable: false })] }));
    renderScreen();
    const toggle = await within(await screen.findByRole('region', { name: 'Loại thông báo' })).findByRole('switch', { name: 'Loại thử A' });

    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
    expect(typesBlock()).toHaveTextContent('luôn được gửi');
  });

  it('FR-10: loại đang tắt inApp thì hiện tắt + khóa kèm lý do (không push khi không có thông báo trong app)', async () => {
    fetchNotificationPreferences.mockResolvedValue(makePrefs({ types: { TYPE_A: { push: true, inApp: false }, TYPE_B: { push: true, inApp: true } } }));
    renderScreen();
    await screen.findByRole('switch', { name: 'Loại thử A' });

    expect(pushSwitch('Loại thử A')).not.toBeChecked();
    expect(pushSwitch('Loại thử A')).toBeDisabled();
    expect(typesBlock()).toHaveTextContent('đang tắt trong ứng dụng');
  });

  it('FR-10: đang tải thì hiện khung chờ; tải lỗi thì có nút "Thử lại" và tải lại được', async () => {
    fetchNotificationPreferences.mockRejectedValueOnce(new CrmApiException({ statusCode: 500, message: 'Máy chủ bận', errorCode: 'INTERNAL' })).mockResolvedValue(makePrefs());
    renderScreen();
    expect(screen.getByLabelText('Đang tải cài đặt thông báo')).toBeInTheDocument();

    expect(await within(typesBlock()).findByText('Máy chủ bận')).toBeInTheDocument();
    await userEvent.click(within(typesBlock()).getByRole('button', { name: 'Thử lại' }));

    expect(await within(typesBlock()).findByRole('switch', { name: 'Loại thử A' })).toBeInTheDocument();
  });
});

describe('Cài đặt thông báo: giờ yên lặng (FR-10)', () => {
  it('FR-10: mặc định tắt (quietHours = null): công tắc tắt, không có ô giờ, nút Lưu bị khóa; không còn ghi chú "chưa có hiệu lực"', async () => {
    renderScreen();
    const toggle = await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' });

    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText('Từ giờ')).not.toBeInTheDocument();
    expect(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' })).toBeDisabled();
    expect(document.body).not.toHaveTextContent('chưa có hiệu lực');
  });

  it('FR-10: bật lần đầu gợi ý 22:00 đến 06:00 (qua nửa đêm) và ghi chú giờ Việt Nam; lưu gửi đúng quietHours', async () => {
    renderScreen();
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' }));

    expect(screen.getByLabelText('Từ giờ')).toHaveValue('22:00');
    expect(screen.getByLabelText('Đến giờ')).toHaveValue('06:00');
    expect(quietBlock()).toHaveTextContent('giờ Việt Nam');
    expect(quietBlock()).toHaveTextContent('Khung qua nửa đêm');

    await userEvent.click(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' }));

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledWith({ types: {}, quietHours: { start: '22:00', end: '06:00' } }));
  });

  it('FR-10: chọn khung giờ khác (không qua nửa đêm) thì lưu đúng giá trị và không hiện ghi chú qua nửa đêm', async () => {
    renderScreen();
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' }));

    fireEvent.change(screen.getByLabelText('Từ giờ'), { target: { value: '12:00' } });
    fireEvent.change(screen.getByLabelText('Đến giờ'), { target: { value: '13:30' } });
    expect(quietBlock()).not.toHaveTextContent('Khung qua nửa đêm');
    await userEvent.click(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' }));

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledWith({ types: {}, quietHours: { start: '12:00', end: '13:30' } }));
  });

  it('FR-10: start = end thì báo lỗi, khóa nút Lưu, không gọi PUT', async () => {
    renderScreen();
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' }));

    fireEvent.change(screen.getByLabelText('Đến giờ'), { target: { value: '22:00' } });

    expect(within(quietBlock()).getByRole('alert')).toHaveTextContent('phải khác nhau');
    expect(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' })).toBeDisabled();
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it('FR-10: xóa trắng một ô giờ thì báo thiếu giờ và không cho lưu', async () => {
    renderScreen();
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' }));

    fireEvent.change(screen.getByLabelText('Từ giờ'), { target: { value: '' } });

    expect(within(quietBlock()).getByRole('alert')).toHaveTextContent('chọn đủ');
    expect(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' })).toBeDisabled();
  });

  it('FR-10: đang có giờ yên lặng thì hiện bật + giờ đã lưu; tắt rồi lưu thì gửi quietHours = null', async () => {
    fetchNotificationPreferences.mockResolvedValue(makePrefs({ quietHours: { start: '21:30', end: '05:45' } }));
    renderScreen();
    const toggle = await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' });
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText('Từ giờ')).toHaveValue('21:30');
    expect(screen.getByLabelText('Đến giờ')).toHaveValue('05:45');

    await userEvent.click(toggle);
    await userEvent.click(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' }));

    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledWith({ types: {}, quietHours: null }));
  });

  it('FR-10: lưu giờ lỗi thì báo lỗi, giữ nguyên bản nháp để thử lại và KHÔNG coi là đã lưu', async () => {
    updateNotificationPreferences.mockRejectedValue(new CrmApiException({ statusCode: 400, message: 'Giờ yên lặng không hợp lệ', errorCode: 'VALIDATION_FAILED' }));
    renderScreen();
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Giờ yên lặng' })).findByRole('switch', { name: 'Bật giờ yên lặng' }));
    await userEvent.click(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' }));

    expect(await screen.findByText('Giờ yên lặng không hợp lệ')).toBeInTheDocument();
    expect(within(quietBlock()).getByRole('switch', { name: 'Bật giờ yên lặng' })).toBeChecked();
    expect(screen.getByLabelText('Từ giờ')).toHaveValue('22:00');
    expect(within(quietBlock()).getByRole('button', { name: 'Lưu giờ yên lặng' })).toBeEnabled();
  });
});

describe('quietHours.ts: hàm thuần (khớp quy tắc BE)', () => {
  it('validateQuietHours: hợp lệ, start = end, sai định dạng, 24:00', () => {
    expect(validateQuietHours({ start: '22:00', end: '06:00' })).toBeNull();
    expect(validateQuietHours({ start: '08:00', end: '08:00' })).toMatch(/khác nhau/);
    expect(validateQuietHours({ start: '', end: '08:00' })).toMatch(/chọn đủ/);
    expect(validateQuietHours({ start: '24:00', end: '08:00' })).toMatch(/chọn đủ/);
    expect(validateQuietHours({ start: '23:59', end: '00:00' })).toBeNull();
  });

  it('isOvernight: start > end là qua nửa đêm; start < end thì không', () => {
    expect(isOvernight({ start: '22:00', end: '06:00' })).toBe(true);
    expect(isOvernight({ start: '06:00', end: '22:00' })).toBe(false);
  });

  it('isSameQuietHours: so null và giá trị', () => {
    expect(isSameQuietHours(null, null)).toBe(true);
    expect(isSameQuietHours(null, { start: '22:00', end: '06:00' })).toBe(false);
    expect(isSameQuietHours({ start: '22:00', end: '06:00' }, { start: '22:00', end: '06:00' })).toBe(true);
    expect(isSameQuietHours({ start: '22:00', end: '06:00' }, { start: '22:00', end: '07:00' })).toBe(false);
  });
});
