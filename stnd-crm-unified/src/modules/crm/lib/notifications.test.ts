import { describe, expect, it } from 'vitest';
import { getNotificationTypeLabel, resolveNotificationPath } from './notifications';

describe('thông báo cũ của luồng xin tham gia nhóm (đã bỏ ở v1.0.5)', () => {
  it.each([['CARE_TEAM_JOIN_REQUESTED', 'Đề nghị tham gia'], ['CARE_TEAM_JOIN_RESOLVED', 'Kết quả đề nghị']])('%s vẫn có nhãn "%s"', (type, label) => {
    expect(getNotificationTypeLabel(type)).toBe(label);
  });

  it.each(['CARE_TEAM_JOIN_REQUESTED', 'CARE_TEAM_JOIN_RESOLVED'])('%s: không có liên kết dù có customerId hay deepLink hợp lệ', (type) => {
    expect(resolveNotificationPath({ type, deepLink: '/crm/customers/CUST-002', customerId: 'CUST-002' })).toBeNull();
    // `/crm/care-team-requests` là deepLink CŨ của luồng đã gỡ (dữ liệu lịch sử còn lưu) — cố ý dùng để chứng minh vẫn không điều hướng.
    expect(resolveNotificationPath({ type, deepLink: '/crm/care-team-requests', customerId: 'CUST-002' })).toBeNull();
    expect(resolveNotificationPath({ type, deepLink: '', appointmentId: 'APT-1' })).toBeNull();
  });
});

describe('resolveNotificationPath: thông báo còn dùng vẫn điều hướng', () => {
  it('hồ sơ khách và lịch hẹn', () => {
    expect(resolveNotificationPath({ type: 'CUSTOMER_ASSIGNED', deepLink: '/crm/customers/665f1c2e8a' })).toBe('/crm/customers/665f1c2e8a');
    expect(resolveNotificationPath({ type: 'APPOINTMENT_DUE', deepLink: '/crm/appointments?x=1' })).toBe('/crm/appointments');
  });

  it('không có type (tương thích cũ) vẫn hoạt động; link lạ không có khách -> null', () => {
    expect(resolveNotificationPath({ deepLink: '/crm/customers/CUST-009', customerId: 'CUST-009' })).toBe('/crm/customers/CUST-009');
    expect(resolveNotificationPath({ type: 'SECURITY_ALERT', deepLink: '/crm/audit-logs' })).toBeNull();
  });
});
