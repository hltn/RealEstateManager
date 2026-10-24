import { BusinessException } from '../../../common/exceptions/business.exception';
import { AppointmentStatus } from './appointment.constants';
import {
  assertEndAfterStart,
  assertRangeValid,
  assertStartNotInPast,
  canTransitionStatus,
  normalizeRemindOffsets,
  parseRangeBoundary,
  planAppointmentReminders,
} from './appointment.rules';

const NOW = new Date('2026-10-24T03:00:00.000Z');
const at = (iso: string) => new Date(iso);

/** Field trong `details` của lỗi nghiệp vụ mà hàm ném ra (undefined nếu không ném). */
const failedField = (action: () => void): unknown => {
  try {
    action();
  } catch (error) {
    return (error as BusinessException).details?.field;
  }
  return undefined;
};

describe('assertStartNotInPast', () => {
  it('cho phép bây giờ, tương lai và quá khứ trong dung sai 5 phút; chặn xa hơn', () => {
    expect(() =>
      assertStartNotInPast(at('2026-10-24T03:30:00.000Z'), NOW),
    ).not.toThrow();
    expect(() =>
      assertStartNotInPast(at('2026-10-24T02:55:00.000Z'), NOW),
    ).not.toThrow();
    expect(
      failedField(() =>
        assertStartNotInPast(at('2026-10-24T02:54:59.999Z'), NOW),
      ),
    ).toBe('startAt');
  });
});

describe('assertEndAfterStart', () => {
  const start = at('2026-10-25T02:00:00.000Z');

  it('bỏ qua khi không có endAt; chặn end <= start và dài hơn 24 giờ', () => {
    expect(() => assertEndAfterStart(start, null)).not.toThrow();
    expect(() =>
      assertEndAfterStart(start, at('2026-10-25T03:00:00.000Z')),
    ).not.toThrow();
    expect(() =>
      assertEndAfterStart(start, at('2026-10-26T02:00:00.000Z')),
    ).not.toThrow();
    expect(failedField(() => assertEndAfterStart(start, start))).toBe('endAt');
    expect(
      failedField(() =>
        assertEndAfterStart(start, at('2026-10-25T01:00:00.000Z')),
      ),
    ).toBe('endAt');
    expect(
      failedField(() =>
        assertEndAfterStart(start, at('2026-10-26T02:00:00.001Z')),
      ),
    ).toBe('endAt');
  });
});

describe('normalizeRemindOffsets', () => {
  it('bỏ trùng, sắp giảm dần; mảng rỗng tường minh = không nhắc (không rơi về mặc định)', () => {
    expect(normalizeRemindOffsets([15, 1440, 60, 60], [60])).toEqual([
      1440, 60, 15,
    ]);
    expect(normalizeRemindOffsets(undefined, [60, 1440])).toEqual([1440, 60]);
    expect(normalizeRemindOffsets([], [60, 1440])).toEqual([]);
  });
});

describe('planAppointmentReminders', () => {
  it('chỉ giữ mốc nhắc còn ở tương lai, tính đúng fireAt theo phút', () => {
    const start = at('2026-10-24T05:00:00.000Z'); // 2 giờ sau NOW
    expect(planAppointmentReminders(start, [1440, 60, 15], NOW)).toEqual([
      { offsetMinutes: 60, fireAt: at('2026-10-24T04:00:00.000Z') },
      { offsetMinutes: 15, fireAt: at('2026-10-24T04:45:00.000Z') },
    ]);
  });

  it('mọi mốc đã qua nhưng lịch còn ở tương lai: MỘT nhắc ngay (now) theo mốc nhỏ nhất', () => {
    expect(
      planAppointmentReminders(at('2026-10-24T03:10:00.000Z'), [60, 1440], NOW),
    ).toEqual([{ offsetMinutes: 60, fireAt: NOW }]);
    expect(
      planAppointmentReminders(at('2026-10-24T03:10:00.000Z'), [60, 15], NOW),
    ).toEqual([{ offsetMinutes: 15, fireAt: NOW }]);
  });

  it('lịch đã/đang diễn ra (startAt <= now) hoặc không có mốc nào thì không nhắc', () => {
    expect(planAppointmentReminders(NOW, [60], NOW)).toEqual([]);
    expect(
      planAppointmentReminders(at('2026-10-24T02:00:00.000Z'), [60], NOW),
    ).toEqual([]);
    expect(
      planAppointmentReminders(at('2026-10-24T03:10:00.000Z'), [], NOW),
    ).toEqual([]);
  });
});

describe('canTransitionStatus', () => {
  const { SCHEDULED, DONE, CANCELED } = AppointmentStatus;

  it.each([
    [SCHEDULED, DONE, true],
    [SCHEDULED, CANCELED, true],
    [DONE, SCHEDULED, true],
    [CANCELED, SCHEDULED, true],
    [DONE, CANCELED, false],
    [CANCELED, DONE, false],
  ])('%s -> %s: %p', (from, to, expected) => {
    expect(canTransitionStatus(from, to)).toBe(expected);
  });
});

describe('khoảng xem lịch', () => {
  it('YYYY-MM-DD là ngày giờ VN (đầu/cuối ngày), ISO đầy đủ giữ nguyên thời điểm', () => {
    expect(parseRangeBoundary('2026-10-24', 'from').toISOString()).toBe(
      '2026-10-23T17:00:00.000Z',
    );
    expect(parseRangeBoundary('2026-10-24', 'to').toISOString()).toBe(
      '2026-10-24T16:59:59.999Z',
    );
    expect(
      parseRangeBoundary('2026-10-24T09:00:00+07:00', 'to').toISOString(),
    ).toBe('2026-10-24T02:00:00.000Z');
  });

  it('chặn to < from, ngày không hợp lệ và khoảng > 62 ngày (đúng 62 ngày thì được)', () => {
    const day = 86_400_000;
    const from = parseRangeBoundary('2026-10-01', 'from');
    expect(() =>
      assertRangeValid(from, new Date(from.getTime() + 62 * day)),
    ).not.toThrow();
    expect(
      failedField(() =>
        assertRangeValid(from, new Date(from.getTime() + 62 * day + 1)),
      ),
    ).toBe('to');
    expect(
      failedField(() => assertRangeValid(from, new Date(from.getTime() - 1))),
    ).toBe('to');
    expect(
      failedField(() => assertRangeValid(from, new Date('khong-hop-le'))),
    ).toBe('from');
  });
});
