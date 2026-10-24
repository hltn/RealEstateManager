import { NotificationType } from './notification.constants';
import {
  isInAppEnabled,
  isValidQuietHours,
  resolveTypePreferences,
} from './notification-preference.rules';

describe('resolveTypePreferences', () => {
  it('chưa lưu gì: mọi loại thông báo đều bật push và hộp thông báo', () => {
    const resolved = resolveTypePreferences(undefined);
    expect(Object.keys(resolved).sort()).toEqual(
      Object.values(NotificationType).sort(),
    );
    expect(Object.values(resolved).every((p) => p.push && p.inApp)).toBe(true);
  });

  it('chỉ đổi loại đã lưu, giữ mặc định cho phần còn lại và bỏ khóa lạ', () => {
    const resolved = resolveTypePreferences({
      [NotificationType.APPOINTMENT_DUE]: { push: false },
      KHONG_TON_TAI: { push: false, inApp: false },
    });
    expect(resolved.APPOINTMENT_DUE).toEqual({ push: false, inApp: true });
    expect(resolved.CUSTOMER_OCCASION).toEqual({ push: true, inApp: true });
    expect(resolved).not.toHaveProperty('KHONG_TON_TAI');
  });
});

describe('isInAppEnabled', () => {
  it('chỉ tắt khi người dùng đặt inApp=false tường minh', () => {
    const stored = { [NotificationType.CARE_LOG_ADDED]: { inApp: false } };
    expect(isInAppEnabled(stored, NotificationType.CARE_LOG_ADDED)).toBe(false);
    expect(isInAppEnabled(stored, NotificationType.APPOINTMENT_DUE)).toBe(true);
    expect(isInAppEnabled(null, NotificationType.APPOINTMENT_DUE)).toBe(true);
  });
});

describe('isValidQuietHours', () => {
  it.each([
    [{ start: '22:00', end: '06:00' }, true],
    [{ start: '00:00', end: '23:59' }, true],
    [{ start: '22:00', end: '22:00' }, false],
    [{ start: '24:00', end: '06:00' }, false],
    [{ start: '9:00', end: '10:00' }, false],
  ])('%j => %p', (value, expected) => {
    expect(isValidQuietHours(value)).toBe(expected);
  });
});
