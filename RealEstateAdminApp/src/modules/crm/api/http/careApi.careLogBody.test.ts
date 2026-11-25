import { describe, expect, it } from 'vitest';
import { buildCareLogBody } from './careApi';

// Test trên body thật của `buildCareLogBody` (không mock): đây là hợp đồng gửi lên `POST care-logs` (BE `forbidNonWhitelisted` + `@OptionalNotNull`).
describe('buildCareLogBody: nextAction của form Nhật ký (công tắc "Tạo lịch hẹn")', () => {
  it('công tắc tắt ({ suggestion, dueAt: null, appointment: undefined }): body chỉ có suggestion, KHÔNG có dueAt và appointment', () => {
    const body = buildCareLogBody({ content: 'Gọi khách', contactChannel: 'CALL', nextAction: { suggestion: ' Gọi lại báo giá ', dueAt: null, appointment: undefined } });
    expect(body.nextAction).toEqual({ suggestion: 'Gọi lại báo giá' });
    const nextAction = body.nextAction as Record<string, unknown>;
    expect('dueAt' in nextAction).toBe(false);
    expect('appointment' in nextAction).toBe(false);
  });

  it('công tắc bật: có dueAt + appointment CALLBACK kèm remindBeforeMinutes [60] -> body giữ nguyên đúng cấu trúc', () => {
    const body = buildCareLogBody({
      content: 'Gọi khách',
      contactChannel: 'ZALO',
      nextAction: { suggestion: 'Xác nhận lịch xem nhà mẫu', dueAt: '2026-10-25T03:15:00.000Z', appointment: { type: 'CALLBACK', remindBeforeMinutes: [60] } },
    });
    expect(body).toEqual({
      content: 'Gọi khách',
      contactChannel: 'ZALO',
      nextAction: { suggestion: 'Xác nhận lịch xem nhà mẫu', dueAt: '2026-10-25T03:15:00.000Z', appointment: { type: 'CALLBACK', remindBeforeMinutes: [60] } },
    });
  });

  it('không suggestion, không dueAt (nextAction rỗng): bỏ hẳn nextAction khỏi body', () => {
    const body = buildCareLogBody({ content: 'x', contactChannel: 'CALL', nextAction: { suggestion: '   ', dueAt: null, appointment: undefined } });
    expect('nextAction' in body).toBe(false);
  });
});
