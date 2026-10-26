/**
 * Kiểm đơn vị hàm tính giờ hẹn theo giờ Việt Nam (lib/api.ts) tại các biên nửa đêm. Hàm thuần nhận `now` nên không cần đồng hồ giả.
 * Đây là chỗ duy nhất chứng minh các spec khác "không phụ thuộc giờ chạy": chúng chỉ dùng `tomorrowSlot` / `planTodaySlot`.
 */
import { test, expect } from '@playwright/test';
import { MIDNIGHT_GUARD_MINUTES, planTodaySlot, tomorrowSlot, vnToday } from '../lib/api';

const vn = (isoLocal: string): Date => new Date(`${isoLocal}+07:00`);
const SECOND = 1000;
const MINUTE = 60 * SECOND;

test.describe('vn-time: giờ hẹn tính từ "bây giờ" theo giờ Việt Nam', () => {
  test('23:56 (cận nửa đêm): ngày mai là ngày kế, mốc hôm nay phải chờ qua nửa đêm rồi lấy 00:05 ngày mới', () => {
    const now = vn('2026-10-26T23:56:00');
    expect(tomorrowSlot(now)).toEqual({ date: '2026-10-27', time: '09:00', iso: '2026-10-27T02:00:00.000Z' });
    const { slot, waitMs } = planTodaySlot(now);
    expect(waitMs).toBe(4 * MINUTE + 2 * SECOND);
    expect(slot).toMatchObject({ date: '2026-10-27', time: '00:05', iso: '2026-10-26T17:05:00.000Z' });
  });

  test('00:03 (ngay sau nửa đêm): mốc hôm nay không chờ, là 00:08 CÙNG ngày; ngày mai là ngày kế của ngày mới', () => {
    const now = vn('2026-10-27T00:03:00');
    expect(tomorrowSlot(now).date).toBe('2026-10-28');
    const { slot, waitMs } = planTodaySlot(now);
    expect(waitMs).toBe(0);
    expect(slot).toMatchObject({ date: '2026-10-27', time: '00:08', iso: '2026-10-26T17:08:00.000Z' });
  });

  test('ranh giới của khoảng đệm: 23:51 còn đủ chỗ (không chờ), 23:52 thì phải chờ', () => {
    const early = planTodaySlot(vn('2026-10-26T23:51:00'));
    expect(early.waitMs).toBe(0);
    expect(early.slot).toMatchObject({ date: '2026-10-26', time: '23:56' });
    const late = planTodaySlot(vn('2026-10-26T23:52:00'));
    expect(late.waitMs).toBe(MIDNIGHT_GUARD_MINUTES * MINUTE + 2 * SECOND);
    expect(late.slot.date).toBe('2026-10-27');
  });

  test('giữa ngày: mốc hôm nay = bây giờ + 5 phút, luôn ở tương lai và cùng ngày', () => {
    const now = vn('2026-10-26T12:00:30');
    const { slot, waitMs } = planTodaySlot(now);
    expect(waitMs).toBe(0);
    expect(slot).toMatchObject({ date: '2026-10-26', time: '12:05' });
    expect(Date.parse(slot.iso)).toBeGreaterThan(now.getTime());
  });

  test('ngày VN khác ngày UTC: 17:30Z là 00:30 ngày hôm sau theo giờ VN', () => {
    const now = new Date('2026-10-26T17:30:00Z');
    expect(vnToday(0, now)).toBe('2026-10-27');
    expect(tomorrowSlot(now)).toMatchObject({ date: '2026-10-28', time: '09:00' });
    expect(planTodaySlot(now).slot).toMatchObject({ date: '2026-10-27', time: '00:35' });
  });
});
