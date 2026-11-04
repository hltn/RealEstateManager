import {
  buildTaskWindow,
  classifyDueAt,
  compareTasks,
  DailyTaskGroup,
  occasionDueAt,
} from './daily-task.rules';

// 03:00 UTC ngày 24/10 = 10:00 sáng 24/10 giờ VN.
const NOW = new Date('2026-10-24T03:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('classifyDueAt (phân nhóm theo ngày giờ VN)', () => {
  it.each([
    // 16:59 UTC ngày 23 = 23:59 ngày 23 giờ VN: vẫn là hôm qua.
    ['2026-10-23T16:59:59.999Z', DailyTaskGroup.OVERDUE],
    // 17:00 UTC ngày 23 = 00:00 ngày 24 giờ VN: đã sang hôm nay.
    ['2026-10-23T17:00:00.000Z', DailyTaskGroup.TODAY],
    // Sáng nay đã qua giờ nhưng vẫn thuộc "Hôm nay" (không bị đẩy sang Quá hạn trong ngày).
    ['2026-10-24T00:30:00.000Z', DailyTaskGroup.TODAY],
    ['2026-10-24T16:59:59.999Z', DailyTaskGroup.TODAY],
    ['2026-10-24T17:00:00.000Z', DailyTaskGroup.UPCOMING],
    // Hết ngày thứ 7 (31/10 giờ VN) còn trong cửa sổ; sang 01/11 thì ngoài.
    ['2026-10-31T16:59:59.999Z', DailyTaskGroup.UPCOMING],
    ['2026-10-31T17:00:00.000Z', null],
  ])('%s => %s', (iso, expected) => {
    expect(classifyDueAt(at(iso), NOW, 7)).toBe(expected);
  });
});

describe('buildTaskWindow khớp classifyDueAt', () => {
  it('mỗi nhóm là khoảng liền kề không chồng lấn; bỏ trống nhóm = từ đầu đến hết cửa sổ Sắp tới', () => {
    const overdue = buildTaskWindow(DailyTaskGroup.OVERDUE, NOW, 7);
    const today = buildTaskWindow(DailyTaskGroup.TODAY, NOW, 7);
    const upcoming = buildTaskWindow(DailyTaskGroup.UPCOMING, NOW, 7);
    const all = buildTaskWindow(undefined, NOW, 7);

    expect(overdue.from).toBeNull();
    expect(today.from!.getTime() - overdue.to!.getTime()).toBe(1);
    expect(upcoming.from!.getTime() - today.to!.getTime()).toBe(1);
    expect(all).toEqual({ from: null, to: upcoming.to });
    expect(today.from!.toISOString()).toBe('2026-10-23T17:00:00.000Z');
    expect(upcoming.to!.toISOString()).toBe('2026-10-31T16:59:59.999Z');
  });
});

describe('occasionDueAt', () => {
  it('08:00 giờ VN của ngày dịp = 01:00 UTC', () => {
    expect(occasionDueAt('2026-11-05').toISOString()).toBe(
      '2026-11-05T01:00:00.000Z',
    );
  });
});

describe('compareTasks', () => {
  it('theo dueAt tăng dần, cùng mốc thì theo id', () => {
    const tasks = [
      { dueAt: at('2026-10-25T00:00:00.000Z'), id: 'b' },
      { dueAt: at('2026-10-24T00:00:00.000Z'), id: 'z' },
      { dueAt: at('2026-10-25T00:00:00.000Z'), id: 'a' },
    ];
    expect([...tasks].sort(compareTasks).map((task) => task.id)).toEqual([
      'z',
      'a',
      'b',
    ]);
  });
});
