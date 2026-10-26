import { describe, expect, it } from 'vitest';
import { buildRescheduleBody } from './rescheduleAppointment';

describe('buildRescheduleBody', () => {
  it('đổi ngày + giờ VN sang ISO UTC, kèm version để khóa lạc quan', () => {
    expect(buildRescheduleBody({ version: 3, startAt: '2026-10-26T02:00:00.000Z', endAt: null }, '2026-10-28', '09:30')).toEqual({ version: 3, startAt: '2026-10-28T02:30:00.000Z' });
  });

  it('lịch có giờ kết thúc: dời theo cùng thời lượng', () => {
    const body = buildRescheduleBody({ version: 1, startAt: '2026-10-26T02:00:00.000Z', endAt: '2026-10-26T03:30:00.000Z' }, '2026-10-28', '09:30');
    expect(body.endAt).toBe('2026-10-28T04:00:00.000Z');
  });
});
