import { describe, expect, it } from 'vitest';
import { getNotificationTypeLabel, resolveNotificationPath } from './notifications';

describe('resolveNotificationPath (deepLink backend -> route Web Admin)', () => {
  it('giữ nguyên link hồ sơ khách', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/customers/66f1a2b3c4d5e6f708192a3b' })).toBe('/crm/customers/66f1a2b3c4d5e6f708192a3b');
  });

  it('thông báo đề nghị tham gia cũ (CARE_TEAM_JOIN_REQUESTED) và link care-team-requests -> không điều hướng, kể cả khi có customerId', () => {
    expect(resolveNotificationPath({ type: 'CARE_TEAM_JOIN_REQUESTED', deepLink: '/crm/care-team-requests', customerId: 'abc123' })).toBeNull();
    expect(resolveNotificationPath({ type: 'CARE_TEAM_JOIN_REQUESTED', deepLink: '/crm/customers/abc123', customerId: 'abc123' })).toBeNull();
    expect(resolveNotificationPath({ deepLink: '/crm/care-team-requests', customerId: 'abc123' })).toBeNull();
  });

  it('thông báo cũ vẫn có nhãn hiển thị; loại khác vẫn điều hướng như trước', () => {
    expect(getNotificationTypeLabel('CARE_TEAM_JOIN_REQUESTED')).toBe('Đề nghị tham gia');
    expect(resolveNotificationPath({ type: 'CUSTOMER_ASSIGNED', deepLink: '/crm/customers/abc123', customerId: 'abc123' })).toBe('/crm/customers/abc123');
  });

  it('lịch hẹn -> màn lịch hẹn; cảnh báo bảo mật (audit-logs) -> không điều hướng', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/appointments/66f1', appointmentId: '66f1' })).toBe('/crm/appointments');
    expect(resolveNotificationPath({ deepLink: '/crm/audit-logs?actorId=1&actions=PHONE_VIEW_ALERT' })).toBeNull();
  });

  it('thông báo tự đổi trạng thái (deepLink hồ sơ khách, có thể kèm query) -> mở đúng hồ sơ khách', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/customers/66f1a2b3c4d5e6f708192a3b', customerId: '66f1a2b3c4d5e6f708192a3b' })).toBe('/crm/customers/66f1a2b3c4d5e6f708192a3b');
    expect(resolveNotificationPath({ deepLink: '/crm/customers/66f1a2b3c4d5e6f708192a3b?tab=history' })).toBe('/crm/customers/66f1a2b3c4d5e6f708192a3b');
  });

  it('không dẫn tới đường dẫn ngoài app (chống link lạ)', () => {
    expect(resolveNotificationPath({ deepLink: 'https://evil.example/crm/customers/abc' })).toBeNull();
    expect(resolveNotificationPath({ deepLink: '//evil.example' })).toBeNull();
  });
});

describe('getNotificationTypeLabel', () => {
  it('dịch loại đã biết, loại lạ -> "Thông báo"', () => {
    expect(getNotificationTypeLabel('APPOINTMENT_DUE')).toBe('Lịch hẹn');
    expect(getNotificationTypeLabel('CUSTOMER_STATUS_AUTO_CHANGED')).toBe('Tự đổi trạng thái');
    expect(getNotificationTypeLabel('UNKNOWN_FUTURE_TYPE')).toBe('Thông báo');
  });
});
