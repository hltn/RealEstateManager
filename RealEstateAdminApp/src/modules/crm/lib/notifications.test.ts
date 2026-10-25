import { describe, expect, it } from 'vitest';
import { getNotificationTypeLabel, resolveNotificationPath } from './notifications';

describe('resolveNotificationPath (deepLink backend -> route Web Admin)', () => {
  it('giữ nguyên link hồ sơ khách', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/customers/66f1a2b3c4d5e6f708192a3b' })).toBe('/crm/customers/66f1a2b3c4d5e6f708192a3b');
  });

  it('link đề nghị tham gia -> hồ sơ khách nếu biết id, nếu không -> danh sách khách', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/care-team-requests', customerId: 'abc123' })).toBe('/crm/customers/abc123');
    expect(resolveNotificationPath({ deepLink: '/crm/care-team-requests' })).toBe('/crm/customers');
  });

  it('lịch hẹn -> màn lịch hẹn; cảnh báo bảo mật (audit-logs) -> không điều hướng', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/appointments/66f1', appointmentId: '66f1' })).toBe('/crm/appointments');
    expect(resolveNotificationPath({ deepLink: '/crm/audit-logs?actorId=1&actions=PHONE_VIEW_ALERT' })).toBeNull();
  });

  it('không dẫn tới đường dẫn ngoài app (chống link lạ)', () => {
    expect(resolveNotificationPath({ deepLink: 'https://evil.example/crm/customers/abc' })).toBeNull();
    expect(resolveNotificationPath({ deepLink: '//evil.example' })).toBeNull();
  });
});

describe('getNotificationTypeLabel', () => {
  it('dịch loại đã biết, loại lạ -> "Thông báo"', () => {
    expect(getNotificationTypeLabel('APPOINTMENT_DUE')).toBe('Lịch hẹn');
    expect(getNotificationTypeLabel('UNKNOWN_FUTURE_TYPE')).toBe('Thông báo');
  });
});
