import {
  addDaysToDateKey,
  diffDateKeys,
  formatVnDateTime,
  vnDateKey,
} from './timezone.util';

describe('tiện ích ngày giờ Việt Nam (UTC+7)', () => {
  it('vnDateKey: 17:00 UTC đã sang ngày hôm sau theo giờ VN, 16:59 UTC thì chưa', () => {
    expect(vnDateKey(new Date('2026-10-24T16:59:59.999Z'))).toBe('2026-10-24');
    expect(vnDateKey(new Date('2026-10-24T17:00:00.000Z'))).toBe('2026-10-25');
  });

  it('addDaysToDateKey: qua cuối tháng, cuối năm và năm nhuận', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDateKey('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('diffDateKeys: số ngày lịch có dấu', () => {
    expect(diffDateKeys('2026-10-24', '2026-10-27')).toBe(3);
    expect(diffDateKeys('2026-10-24', '2026-10-20')).toBe(-4);
    expect(diffDateKeys('2026-10-24', '2026-10-24')).toBe(0);
  });

  it('formatVnDateTime: đổi sang giờ VN và qua ngày khi cần', () => {
    expect(formatVnDateTime(new Date('2026-10-24T02:30:00.000Z'))).toBe(
      '09:30 24/10/2026',
    );
    expect(formatVnDateTime(new Date('2026-10-24T18:05:00.000Z'))).toBe(
      '01:05 25/10/2026',
    );
  });
});
