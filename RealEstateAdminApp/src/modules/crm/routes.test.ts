import { describe, expect, it } from 'vitest';
import { buildCreateAppointmentPath, hasInvalidCreateAppointmentCustomerId, parseCreateAppointmentCustomerId, parseCreateAppointmentProjectId } from './routes';

const VALID_ID = '6add87b88f689f6e6cd96833';
const PROJECT_ID = '6add87b88f689f6e6cd96aaa';

describe('đường dẫn màn tạo lịch hẹn mang khách (G5)', () => {
  it('có khách hợp lệ: gắn ?customerId=, đọc ngược lại đúng id', () => {
    const path = buildCreateAppointmentPath({ customerId: VALID_ID });
    expect(path).toBe(`/crm/appointments/new?customerId=${VALID_ID}`);
    expect(parseCreateAppointmentCustomerId(path.slice(path.indexOf('?')))).toBe(VALID_ID);
  });

  it('không có khách hoặc id sai định dạng ObjectId: không gắn query, đọc ra null', () => {
    expect(buildCreateAppointmentPath()).toBe('/crm/appointments/new');
    expect(buildCreateAppointmentPath({ customerId: 'abc', projectId: '<script>' })).toBe('/crm/appointments/new');
    expect(parseCreateAppointmentCustomerId('')).toBeNull();
    expect(parseCreateAppointmentCustomerId('?customerId=abc')).toBeNull();
    expect(parseCreateAppointmentCustomerId(`?customerId=${VALID_ID}0`)).toBeNull();
    expect(parseCreateAppointmentCustomerId('?customerId=%3Cscript%3E')).toBeNull();
  });

  it('mang cả khách và dự án (G7): đọc lại đúng từng id; id dự án sai định dạng bị bỏ', () => {
    const path = buildCreateAppointmentPath({ customerId: VALID_ID, projectId: PROJECT_ID });
    expect(path).toBe(`/crm/appointments/new?customerId=${VALID_ID}&projectId=${PROJECT_ID}`);
    const search = path.slice(path.indexOf('?'));
    expect(parseCreateAppointmentCustomerId(search)).toBe(VALID_ID);
    expect(parseCreateAppointmentProjectId(search)).toBe(PROJECT_ID);
    expect(buildCreateAppointmentPath({ projectId: PROJECT_ID })).toBe(`/crm/appointments/new?projectId=${PROJECT_ID}`);
    expect(parseCreateAppointmentProjectId('?projectId=abc')).toBeNull();
    expect(parseCreateAppointmentProjectId('')).toBeNull();
  });
});

describe('hasInvalidCreateAppointmentCustomerId', () => {
  it('chỉ true khi có tham số customerId nhưng sai định dạng', () => {
    expect(hasInvalidCreateAppointmentCustomerId('?customerId=zzz')).toBe(true);
    expect(hasInvalidCreateAppointmentCustomerId('?customerId=')).toBe(true);
    expect(hasInvalidCreateAppointmentCustomerId('')).toBe(false);
    expect(hasInvalidCreateAppointmentCustomerId('?projectId=zzz')).toBe(false);
    expect(hasInvalidCreateAppointmentCustomerId(`?customerId=${'a'.repeat(24)}`)).toBe(false);
  });
});
