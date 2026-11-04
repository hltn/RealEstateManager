import {
  appointmentDedupeKey,
  buildOccasionTargets,
  occasionDedupeKey,
  occasionFallsOn,
  staleAnchorDate,
  staleDedupeKey,
} from './reminder-planner';

describe('appointmentDedupeKey', () => {
  const start = new Date('2026-10-25T02:00:00.000Z');

  it('ổn định với cùng (lịch, mốc, giờ hẹn) nhưng đổi khi dời giờ hoặc đổi mốc nhắc', () => {
    const key = appointmentDedupeKey('a1', 60, start);
    expect(appointmentDedupeKey('a1', 60, new Date(start))).toBe(key);
    expect(
      appointmentDedupeKey('a1', 60, new Date('2026-10-25T03:00:00.000Z')),
    ).not.toBe(key);
    expect(appointmentDedupeKey('a1', 15, start)).not.toBe(key);
    expect(appointmentDedupeKey('a2', 60, start)).not.toBe(key);
  });
});

describe('occasionFallsOn', () => {
  it('khớp đúng tháng/ngày; 29/02 chỉ rơi vào 28/02 ở năm không nhuận', () => {
    expect(occasionFallsOn({ month: 11, day: 5 }, '2026-11-05')).toBe(true);
    expect(occasionFallsOn({ month: 11, day: 5 }, '2026-11-06')).toBe(false);
    expect(occasionFallsOn({ month: 2, day: 29 }, '2027-02-28')).toBe(true);
    expect(occasionFallsOn({ month: 2, day: 29 }, '2028-02-28')).toBe(false);
    expect(occasionFallsOn({ month: 2, day: 29 }, '2028-02-29')).toBe(true);
    expect(occasionFallsOn({ month: 2, day: 28 }, '2027-02-28')).toBe(true);
  });
});

describe('buildOccasionTargets', () => {
  it('tính ngày dịp theo giờ VN, qua cuối tháng, bỏ trùng/âm và sắp tăng dần', () => {
    expect(buildOccasionTargets('2026-10-31', [1, 0, 1, -2])).toEqual([
      { leadDays: 0, dateKey: '2026-10-31' },
      { leadDays: 1, dateKey: '2026-11-01' },
    ]);
  });
});

describe('khóa chống trùng theo đợt', () => {
  it('nhắc dịp: cùng ngày xảy ra nhưng khác leadDays là hai nhắc khác nhau', () => {
    expect(occasionDedupeKey('c1', 'birthday', '2026-11-05', 1)).not.toBe(
      occasionDedupeKey('c1', 'birthday', '2026-11-05', 0),
    );
  });

  it('khách lâu chưa chăm sóc: neo theo nhật ký mới nhất (ngày VN), chưa có nhật ký thì neo theo ngày tạo', () => {
    const created = new Date('2026-09-01T10:00:00.000Z');
    expect(staleAnchorDate(null, created)).toBe('2026-09-01');
    // 20:00 UTC = 03:00 ngày hôm sau giờ VN.
    expect(staleAnchorDate(new Date('2026-09-10T20:00:00.000Z'), created)).toBe(
      '2026-09-11',
    );
    expect(staleDedupeKey('c1', '2026-09-11')).not.toBe(
      staleDedupeKey('c1', '2026-09-01'),
    );
  });
});
