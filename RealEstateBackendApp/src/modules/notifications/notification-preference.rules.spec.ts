import { NotificationType } from './notification.constants';
import {
  isInAppEnabled,
  isInQuietHours,
  isValidQuietHours,
  resolveTypePreferences,
  toVnHHmm,
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

describe('isInQuietHours (T-30)', () => {
  const day = { start: '09:00', end: '17:00' };
  const night = { start: '22:00', end: '06:00' };

  it.each([
    ['08:59', false],
    ['09:00', true],
    ['12:00', true],
    ['16:59', true],
    ['17:00', false],
  ])(
    'khung trong ngày 09:00-17:00 lúc %s => %p (start bao gồm, end không)',
    (now, expected) => {
      expect(isInQuietHours(now, day)).toBe(expected);
    },
  );

  it.each([
    ['21:59', false],
    ['22:00', true],
    ['23:59', true],
    ['00:00', true],
    ['05:59', true],
    ['06:00', false],
    ['12:00', false],
  ])('khung qua nửa đêm 22:00-06:00 lúc %s => %p', (now, expected) => {
    expect(isInQuietHours(now, night)).toBe(expected);
  });

  it('mặc định tắt: quietHours null/undefined luôn false', () => {
    expect(isInQuietHours('23:00', null)).toBe(false);
    expect(isInQuietHours('23:00', undefined)).toBe(false);
  });

  it('start = end hoặc sai định dạng: false, không chặn nhầm push', () => {
    expect(isInQuietHours('10:00', { start: '10:00', end: '10:00' })).toBe(
      false,
    );
    expect(isInQuietHours('10:00', { start: '9:00', end: '11:00' })).toBe(
      false,
    );
    expect(isInQuietHours('25:00', day)).toBe(false);
  });
});

describe('toVnHHmm', () => {
  it('đổi UTC sang giờ Việt Nam (UTC+7), qua cả ngày', () => {
    expect(toVnHHmm(new Date('2026-01-01T00:00:00Z'))).toBe('07:00');
    expect(toVnHHmm(new Date('2026-01-01T16:59:00Z'))).toBe('23:59');
    expect(toVnHHmm(new Date('2026-01-01T17:00:00Z'))).toBe('00:00');
  });
});
