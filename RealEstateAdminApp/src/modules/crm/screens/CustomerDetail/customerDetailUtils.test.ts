import { describe, expect, it } from 'vitest';
import { CRITERIA_KEYS } from '@crm/lib/customerRules';
import {
  CRITERIA_ITEMS,
  fromDateTimeLocalValue,
  getHiddenImageCount,
  getShortCaption,
  getSuggestedFollowUpIso,
  orEmptyText,
  selectUpcomingAppointments,
  toDateTimeLocalValue,
} from './customerDetailUtils';

describe('customerDetailUtils', () => {
  it('mỗi tiêu chí trên giao diện ứng với đúng 1 khoá tiêu chí của lớp quy tắc, đủ 4 và không trùng (C4)', () => {
    expect(CRITERIA_ITEMS.map((item) => item.key)).toEqual([...CRITERIA_KEYS]);
    expect(new Set(CRITERIA_ITEMS.map((item) => item.label)).size).toBe(4);
  });

  it('getShortCaption lấy N từ đầu', () => {
    expect(getShortCaption('  Sa bàn thực tế dự án ')).toBe('Sa bàn');
    expect(getShortCaption('Một', 3)).toBe('Một');
  });

  it('getHiddenImageCount không âm', () => {
    expect(getHiddenImageCount(5, 3)).toBe(2);
    expect(getHiddenImageCount(2, 3)).toBe(0);
  });

  it('orEmptyText thay giá trị trống', () => {
    expect(orEmptyText('  ')).toBe('Chưa cập nhật');
    expect(orEmptyText(null)).toBe('Chưa cập nhật');
    expect(orEmptyText('Hà Nội')).toBe('Hà Nội');
  });

  it('mốc hẹn gợi ý = hôm nay (giờ VN) + N ngày lúc 09:00; N null -> không gợi ý', () => {
    // 23:30 ngày 21/10 UTC = 06:30 ngày 22/10 giờ VN -> "hôm nay" là 22/10.
    const now = new Date('2026-10-21T23:30:00.000Z');
    expect(getSuggestedFollowUpIso(2, now)).toBe('2026-10-24T02:00:00.000Z');
    expect(getSuggestedFollowUpIso(null, now)).toBe('');
  });

  it('chuyển đổi datetime-local theo giờ VN 2 chiều', () => {
    expect(toDateTimeLocalValue('2026-10-24T02:00:00.000Z')).toBe('2026-10-24T09:00');
    expect(fromDateTimeLocalValue('2026-10-24T09:00')).toBe('2026-10-24T02:00:00.000Z');
    expect(fromDateTimeLocalValue('')).toBe('');
  });

  it('selectUpcomingAppointments: chỉ lịch đang chờ và chưa qua giờ, gần nhất trước', () => {
    const now = new Date('2026-10-26T03:00:00.000Z');
    const items = [
      { id: 'late', status: 'SCHEDULED', startAt: '2026-10-28T02:00:00.000Z' },
      { id: 'past', status: 'SCHEDULED', startAt: '2026-10-26T02:00:00.000Z' },
      { id: 'done', status: 'DONE', startAt: '2026-10-27T02:00:00.000Z' },
      { id: 'soon', status: 'SCHEDULED', startAt: '2026-10-26T04:00:00.000Z' },
    ];
    expect(selectUpcomingAppointments(items, now).map((item) => item.id)).toEqual(['soon', 'late']);
  });
});
