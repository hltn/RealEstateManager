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
    expect(parseCreateAppointmentProjectId('?projectId=%3Cscript%3E')).toBeNull();
    expect(parseCreateAppointmentProjectId('')).toBeNull();
  });
  it('id dự án ở giao diện là MÃ dự án (T-15), không phải ObjectId: mang được qua URL và đọc lại đúng; ký tự lạ hoặc quá dài bị bỏ', () => {
    for (const code of ['QTERRA', 'E2E4897F6', 'proj-1', 'A_B']) {
      const path = buildCreateAppointmentPath({ projectId: code });
      expect(path).toBe(`/crm/appointments/new?projectId=${code}`);
      expect(parseCreateAppointmentProjectId(path.slice(path.indexOf('?')))).toBe(code);
    }
    expect(buildCreateAppointmentPath({ customerId: VALID_ID, projectId: 'QTERRA' })).toBe(`/crm/appointments/new?customerId=${VALID_ID}&projectId=QTERRA`);
    for (const bad of ['a b', '<script>', 'x'.repeat(31), '']) {
      expect(buildCreateAppointmentPath({ projectId: bad })).toBe('/crm/appointments/new');
    }
    expect(parseCreateAppointmentProjectId(`?projectId=${'x'.repeat(31)}`)).toBeNull();
    // id khách vẫn chỉ nhận ObjectId: mã dự án không được lọt qua cửa khách.
    expect(buildCreateAppointmentPath({ customerId: 'QTERRA' })).toBe('/crm/appointments/new');
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
