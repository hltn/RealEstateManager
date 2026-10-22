import { describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  diffDateKeys,
  formatVnDate,
  formatVnDateTime,
  formatVnRelative,
  getDayPeriod,
  getIsoDateParts,
  parseDmyToDateKey,
  toVnDateKey,
  toVnTime,
  vnDateTimeToIso,
} from './dateTime';

describe('múi giờ Việt Nam cố định (GMT+7)', () => {
  it('18:30 UTC đã là ngày hôm sau ở Việt Nam', () => {
    expect(toVnDateKey('2026-10-21T18:30:00.000Z')).toBe('2026-10-22');
    expect(toVnTime('2026-10-21T18:30:00.000Z')).toBe('01:30');
  });

  it('vnDateTimeToIso đổi giờ VN sang UTC và ngược lại', () => {
    const iso = vnDateTimeToIso('2026-10-21', '09:30');
    expect(iso).toBe('2026-10-21T02:30:00.000Z');
    expect(formatVnDateTime(iso)).toBe('21/10/2026 09:30');
  });

  it('vnDateTimeToIso trả rỗng khi sai định dạng', () => {
    expect(vnDateTimeToIso('21/10/2026', '09:30')).toBe('');
    expect(vnDateTimeToIso('2026-10-21', '25:00')).toBe('');
  });

  it('formatVnDate luôn có năm, giá trị rỗng -> chuỗi rỗng', () => {
    expect(formatVnDate('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
    expect(formatVnDate(null)).toBe('');
  });
});

describe('nhãn tương đối', () => {
  const now = new Date('2026-10-22T03:00:00.000Z');
  it('Hôm nay / Hôm qua / Ngày mai / ngày đầy đủ', () => {
    expect(formatVnRelative('2026-10-22T08:00:00.000Z', now)).toBe('Hôm nay 15:00');
    expect(formatVnRelative('2026-10-21T02:00:00.000Z', now)).toBe('Hôm qua 09:00');
    expect(formatVnRelative('2026-10-23T02:00:00.000Z', now, false)).toBe('Ngày mai');
    expect(formatVnRelative('2026-10-01T02:00:00.000Z', now)).toBe('01/10/2026 09:00');
  });
});

describe('tính ngày', () => {
  it('addDaysToDateKey qua tháng/năm', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('diffDateKeys có dấu', () => {
    expect(diffDateKeys('2026-10-22', '2026-10-20')).toBe(-2);
    expect(diffDateKeys('2026-10-22', '2026-11-01')).toBe(10);
  });
  it('parseDmyToDateKey từ chối ngày không tồn tại', () => {
    expect(parseDmyToDateKey('15/11/1984')).toBe('1984-11-15');
    expect(parseDmyToDateKey('31/02/2020')).toBe('');
  });
  it('getIsoDateParts trả thứ trong tuần', () => {
    expect(getIsoDateParts('2026-10-22')).toEqual({ dayOfWeek: 'T5', dayNumber: 22 });
  });
  it('getDayPeriod theo giờ VN', () => {
    expect(getDayPeriod('11:59')).toBe('morning');
    expect(getDayPeriod('2026-10-22T05:00:00.000Z')).toBe('afternoon');
  });
});

describe('ranh giới múi giờ VN (UTC+7, không DST)', () => {
  it('toVnDateKey: 16:59:59.999Z còn ngày cũ, 17:00:00Z sang ngày mới', async () => {
    const { toVnDateKey } = await import('./dateTime');
    expect(toVnDateKey('2026-10-21T16:59:59.999Z')).toBe('2026-10-21');
    expect(toVnDateKey('2026-10-21T17:00:00.000Z')).toBe('2026-10-22');
    expect(toVnDateKey('2026-12-31T17:00:00.000Z')).toBe('2027-01-01');
    expect(toVnDateKey(new Date('2026-10-21T16:59:59.999Z'))).toBe('2026-10-21');
  });
});
