import { describe, expect, it } from 'vitest';
import { validateAppointmentForm } from './createAppointmentForm';
import type { AppointmentFormValues } from './createAppointmentForm';

const values = (date: string): AppointmentFormValues => ({
  customerId: 'CUST-001',
  type: 'CALLBACK',
  title: '',
  date,
  time: '10:00',
  location: '',
  note: '',
  assigneeId: 'hanh',
  remindBeforeMinutes: 60,
  smsZnsAuto: false,
  calendarSync: false,
});

describe('kiểm ngày quá khứ khi tạo lịch hẹn', () => {
  it('ngày trước hôm nay (giờ VN) bị từ chối; hôm nay và tương lai hợp lệ', () => {
    expect(validateAppointmentForm(values('2026-10-21'), null, '2026-10-22').date).toBe('Ngày hẹn không được ở quá khứ.');
    expect(validateAppointmentForm(values('2026-10-22'), null, '2026-10-22').date).toBeUndefined();
    expect(validateAppointmentForm(values('2026-10-23'), null, '2026-10-22').date).toBeUndefined();
  });
});
