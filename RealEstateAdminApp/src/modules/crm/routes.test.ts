import { describe, expect, it } from 'vitest';
import { buildCreateAppointmentPath, parseCreateAppointmentCustomerId } from './routes';

const VALID_ID = '6add87b88f689f6e6cd96833';

describe('đường dẫn màn tạo lịch hẹn mang khách (G5)', () => {
  it('có khách hợp lệ: gắn ?customerId=, đọc ngược lại đúng id', () => {
    const path = buildCreateAppointmentPath(VALID_ID);
    expect(path).toBe(`/crm/appointments/new?customerId=${VALID_ID}`);
    expect(parseCreateAppointmentCustomerId(path.slice(path.indexOf('?')))).toBe(VALID_ID);
  });

  it('không có khách hoặc id sai định dạng ObjectId: không gắn query, đọc ra null', () => {
    expect(buildCreateAppointmentPath()).toBe('/crm/appointments/new');
    expect(buildCreateAppointmentPath('abc')).toBe('/crm/appointments/new');
    expect(parseCreateAppointmentCustomerId('')).toBeNull();
    expect(parseCreateAppointmentCustomerId('?customerId=abc')).toBeNull();
    expect(parseCreateAppointmentCustomerId(`?customerId=${VALID_ID}0`)).toBeNull();
    expect(parseCreateAppointmentCustomerId('?customerId=%3Cscript%3E')).toBeNull();
  });
});
