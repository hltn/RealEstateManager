import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock ở tầng axios (không mock `crmHttp`) để kiểm cả việc bóc `{ data }` và việc lỗi đi ra là `CrmApiException`.
const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));

import { CrmApiException } from './crmErrors';
import { fetchNotificationPreferences, updateNotificationPreferences, type NotificationPreferences } from './notificationPreferencesApi';

const preferences: NotificationPreferences = {
  types: { APPOINTMENT_REMINDER: { push: true, inApp: true }, STALE_CUSTOMER: { push: false, inApp: true } },
  quietHours: { start: '22:00', end: '07:00' },
  pushTypes: [{ type: 'APPOINTMENT_REMINDER', label: 'Nhắc lịch hẹn', description: 'Trước giờ hẹn', defaultEnabled: true, canDisable: true }],
};

const failure = (status: number, data: unknown): AxiosError => {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('x', 'ERR_BAD_REQUEST', config, {}, { status, data, statusText: '', headers: {}, config } as AxiosResponse);
};

beforeEach(() => {
  request.mockReset();
});

describe('notificationPreferencesApi: hợp đồng /notification-preferences/me (T-42)', () => {
  it('GET: đúng URL/method, không body, bóc `data` của { data } và truyền signal', async () => {
    request.mockResolvedValueOnce({ data: { data: preferences } });
    const controller = new AbortController();

    const result = await fetchNotificationPreferences(controller.signal);

    expect(result).toEqual(preferences);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'get', url: '/notification-preferences/me', data: undefined, signal: controller.signal });
  });

  it('PUT: đúng URL/method, gửi nguyên body (loại đổi + quietHours) và bóc `data`', async () => {
    const updated: NotificationPreferences = { ...preferences, quietHours: null };
    request.mockResolvedValueOnce({ data: { data: updated } });
    const body = { types: { STALE_CUSTOMER: { push: false, inApp: false } }, quietHours: null };

    const result = await updateNotificationPreferences(body);

    expect(result).toEqual(updated);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'put', url: '/notification-preferences/me', data: body });
    // `quietHours: null` (tắt giờ yên lặng) phải đi nguyên là null, không bị bỏ khóa.
    expect(request.mock.calls[0][0].data).toHaveProperty('quietHours', null);
  });

  it('PUT bỏ khóa quietHours: không tự thêm khóa (BE hiểu là giữ nguyên)', async () => {
    request.mockResolvedValueOnce({ data: { data: preferences } });
    await updateNotificationPreferences({ types: { APPOINTMENT_REMINDER: { push: false, inApp: true } } });
    expect(request.mock.calls[0][0].data).not.toHaveProperty('quietHours');
  });

  it('lỗi 400 của BE ném CrmApiException mang errorCode (không lộ AxiosError thô)', async () => {
    request.mockRejectedValueOnce(failure(400, { statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Giờ yên lặng không hợp lệ' }));

    const error = await updateNotificationPreferences({ types: {}, quietHours: { start: '07:00', end: '07:00' } }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrmApiException);
    expect((error as CrmApiException).apiError).toMatchObject({ statusCode: 400, errorCode: 'VALIDATION_FAILED' });
  });
});
