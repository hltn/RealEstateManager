import { describe, expect, it } from 'vitest';
import { createCustomerRecord } from '@crm/test/customerFactory';
import { createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { crmReducer, type MutationMeta } from './crmReducer';

const NOW = FIXED_NOW.toISOString();
const meta = (actorId = 'hanh', changeLogId = 'CHG-1'): MutationMeta => ({ actorId, now: NOW, changeLogId });

describe('crmReducer — cập nhật khách (C7, X4)', () => {
  it('tự ghi lastUpdatedAt/By, tăng version và ghi nhật ký thay đổi cũ -> mới', () => {
    const state = createTestState();
    const before = state.customers.find((customer) => customer.id === 'CUST-001');
    const next = crmReducer(state, { type: 'customers/update', customerId: 'CUST-001', patch: { statusId: 'NET' }, action: 'STATUS_CHANGED', meta: meta('thao') });
    const after = next.customers.find((customer) => customer.id === 'CUST-001');
    expect(after?.lastUpdatedAt).toBe(NOW);
    expect(after?.lastUpdatedBy).toBe('thao');
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    expect(after?.statusChangedAt).toBe(NOW);
    expect(next.changeLogs[0]).toMatchObject({
      customerId: 'CUST-001',
      action: 'STATUS_CHANGED',
      actorId: 'thao',
      actorName: 'Thảo',
      changes: [{ field: 'Tình trạng', from: 'Có quan tâm', to: 'Khách net' }],
    });
  });

  it('patch không đổi gì -> giữ nguyên state (không ghi log rỗng, không tăng version)', () => {
    const state = createTestState();
    const next = crmReducer(state, { type: 'customers/update', customerId: 'CUST-001', patch: { statusId: 'INTERESTED' }, action: 'STATUS_CHANGED', meta: meta() });
    expect(next).toBe(state);
  });

  it('chặn nhóm chăm sóc không có đúng 1 phụ trách chính', () => {
    const state = createTestState();
    const next = crmReducer(state, {
      type: 'customers/update',
      customerId: 'CUST-001',
      patch: { careTeam: [{ userId: 'thao', role: 'MEMBER', addedBy: 'hanh', addedAt: NOW }] },
      action: 'CARE_TEAM_MEMBER_REMOVED',
      meta: meta(),
    });
    expect(next).toBe(state);
  });

  it('đổi phụ trách chính cập nhật primaryAssigneeId (phi chuẩn hoá)', () => {
    const state = createTestState();
    const next = crmReducer(state, {
      type: 'customers/update',
      customerId: 'CUST-001',
      patch: {
        careTeam: [
          { userId: 'thao', role: 'PRIMARY', addedBy: 'hanh', addedAt: NOW },
          { userId: 'hanh', role: 'MEMBER', addedBy: 'hanh', addedAt: NOW },
        ],
      },
      action: 'PRIMARY_CHANGED',
      meta: meta(),
    });
    expect(next.customers.find((customer) => customer.id === 'CUST-001')?.primaryAssigneeId).toBe('thao');
  });
});

describe('crmReducer — tạo khách (QT3, QT4)', () => {
  const newCustomer = (overrides: Parameters<typeof createCustomerRecord>[0]) =>
    createCustomerRecord({ fullName: 'Khách Mới', phone: '+84900000001', careTeam: [{ userId: 'hanh', role: 'PRIMARY', addedBy: 'hanh', addedAt: NOW }], ...overrides });

  it('thêm khách hợp lệ lên đầu + ghi CUSTOMER_CREATED', () => {
    const state = createTestState();
    const next = crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-1' }), meta: meta() });
    expect(next.customers[0].id).toBe('NEW-1');
    expect(next.changeLogs[0].action).toBe('CUSTOMER_CREATED');
  });

  it('v1.0.5: cho phép SĐT TRÙNG khách khác (FR-03) và khách chưa có SĐT (phone null, FR-02); chặn thiếu tên và SĐT sai định dạng', () => {
    const state = createTestState();
    const existingPhone = state.customers.find((customer) => customer.phone)?.phone ?? '';
    const duplicated = crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-2', phone: existingPhone }), meta: meta() });
    expect(duplicated.customers[0]).toMatchObject({ id: 'NEW-2', phone: existingPhone });
    const noPhone = crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-4', phone: null }), meta: meta() });
    expect(noPhone.customers[0]).toMatchObject({ id: 'NEW-4', phone: null });
    expect(crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-3', fullName: '  ' }), meta: meta() })).toBe(state);
    expect(crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-5', phone: 'abc' }), meta: meta() })).toBe(state);
  });

  it('mã khách: khách mới chưa có mã được cấp mã kế tiếp (lớn nhất + 1); đã có mã thì giữ nguyên', () => {
    const state = createTestState();
    const maxSequence = Math.max(...state.customers.map((customer) => Number(customer.customerCode?.slice(3) ?? 0)));
    const next = crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-6' }), meta: meta() });
    expect(next.customers[0].customerCode).toBe(`KH-${String(maxSequence + 1).padStart(6, '0')}`);
    const keep = crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-7', customerCode: 'KH-900000' }), meta: meta() });
    expect(keep.customers[0].customerCode).toBe('KH-900000');
  });
});

describe('crmReducer — nhật ký, lịch hẹn', () => {
  it('thêm nhật ký cập nhật lastCareLogAt + ngày cập nhật cuối', () => {
    const state = createTestState();
    const next = crmReducer(state, {
      type: 'careLogs/add',
      careLog: { id: 'L-NEW', customerId: 'CUST-006', authorId: 'hanh', authorName: 'Hạnh', occurredAt: NOW, content: 'Gọi khách', contactChannel: 'CALL', contactResultId: null, nextAction: null, source: 'MANUAL' },
      meta: meta(),
    });
    const customer = next.customers.find((item) => item.id === 'CUST-006');
    expect(next.careLogs[0].id).toBe('L-NEW');
    expect(customer?.lastCareLogAt).toBe(NOW);
    expect(customer?.lastUpdatedAt).toBe(NOW);
    expect(next.changeLogs[0].action).toBe('CARE_LOG_CREATED');
  });

  it('nhật ký rỗng bị bỏ qua', () => {
    const state = createTestState();
    const next = crmReducer(state, {
      type: 'careLogs/add',
      careLog: { id: 'L-EMPTY', customerId: 'CUST-006', authorId: 'hanh', authorName: 'Hạnh', occurredAt: NOW, content: '   ', contactChannel: 'CALL', contactResultId: null, nextAction: null, source: 'MANUAL' },
      meta: meta(),
    });
    expect(next).toBe(state);
  });

  it('đánh dấu lịch hẹn xong -> nextAppointmentAt chuyển sang lịch kế tiếp', () => {
    const state = createTestState();
    const customerBefore = state.customers.find((item) => item.id === 'CUST-001');
    expect(customerBefore?.nextAppointmentAt).not.toBeNull();
    const next = crmReducer(state, { type: 'appointments/setStatus', appointmentId: 'APT-003', status: 'DONE', meta: meta() });
    expect(next.appointments.find((item) => item.id === 'APT-003')?.completedAt).toBe(NOW);
    expect(next.customers.find((item) => item.id === 'CUST-001')?.nextAppointmentAt).toBeNull();
  });
});

describe('crmReducer — UI state', () => {
  it('filters/reset giữ tab đang chọn, xoá bộ lọc khác', () => {
    const state = createTestState();
    const filtered = crmReducer(state, { type: 'filters/set', changes: { listGroup: 'NET', projectIds: ['QTERRA'], q: 'an' } });
    const reset = crmReducer(filtered, { type: 'filters/reset' });
    expect(reset.filters.listGroup).toBe('NET');
    expect(reset.filters.projectIds).toEqual([]);
    expect(reset.filters.q).toBe('');
  });

  it('filters/reset xóa cả bộ lọc chân dung (FR-49)', () => {
    const filtered = crmReducer(createTestState(), { type: 'filters/set', changes: { personaFilters: ['property_type:APT', 'loan_support:true'] } });
    expect(crmReducer(filtered, { type: 'filters/reset' }).filters.personaFilters).toEqual([]);
  });

  it('filters/dropTags gỡ đúng id thẻ đã gộp/xóa, giữ thẻ khác và bộ lọc khác', () => {
    const state = createTestState();
    const filtered = crmReducer(state, { type: 'filters/set', changes: { tagIds: ['t-golf', 't-bs', 't-gon'], projectIds: ['QTERRA'] } });
    const next = crmReducer(filtered, { type: 'filters/dropTags', tagIds: ['t-golf', 't-gon'] });
    expect(next.filters.tagIds).toEqual(['t-bs']);
    expect(next.filters.projectIds).toEqual(['QTERRA']);
  });

  it('filters/dropTags không có id khớp: trả nguyên state (không render lại)', () => {
    const state = createTestState();
    const filtered = crmReducer(state, { type: 'filters/set', changes: { tagIds: ['t-bs'] } });
    expect(crmReducer(filtered, { type: 'filters/dropTags', tagIds: ['t-golf'] })).toBe(filtered);
    expect(crmReducer(state, { type: 'filters/dropTags', tagIds: ['t-golf'] })).toBe(state);
  });

  it('filters/replaceTag (gộp A vào B): thay A bằng B tại chỗ, giữ thẻ khác và bộ lọc khác', () => {
    const filtered = crmReducer(createTestState(), { type: 'filters/set', changes: { tagIds: ['t-bs', 't-golf', 't-gon'], projectIds: ['QTERRA'] } });
    const next = crmReducer(filtered, { type: 'filters/replaceTag', fromTagId: 't-golf', toTagId: 't-new' });
    expect(next.filters.tagIds).toEqual(['t-bs', 't-new', 't-gon']);
    expect(next.filters.projectIds).toEqual(['QTERRA']);
  });

  it('filters/replaceTag khi B đã trong bộ lọc: không trùng id', () => {
    const filtered = crmReducer(createTestState(), { type: 'filters/set', changes: { tagIds: ['t-golf', 't-gon'] } });
    expect(crmReducer(filtered, { type: 'filters/replaceTag', fromTagId: 't-golf', toTagId: 't-gon' }).filters.tagIds).toEqual(['t-gon']);
    const reversed = crmReducer(createTestState(), { type: 'filters/set', changes: { tagIds: ['t-gon', 't-golf'] } });
    expect(crmReducer(reversed, { type: 'filters/replaceTag', fromTagId: 't-golf', toTagId: 't-gon' }).filters.tagIds).toEqual(['t-gon']);
  });

  it('filters/replaceTag khi A không có trong bộ lọc: trả nguyên state và KHÔNG thêm B', () => {
    const filtered = crmReducer(createTestState(), { type: 'filters/set', changes: { tagIds: ['t-bs'] } });
    expect(crmReducer(filtered, { type: 'filters/replaceTag', fromTagId: 't-golf', toTagId: 't-gon' })).toBe(filtered);
  });

  it('filters/pruneStaleTags gỡ id thẻ không còn tồn tại, giữ id còn tồn tại', () => {
    const filtered = crmReducer(createTestState(), { type: 'filters/set', changes: { tagIds: ['t-golf', 't-gone', 't-bs'], q: 'an' } });
    const next = crmReducer(filtered, { type: 'filters/pruneStaleTags', existingTagIds: ['t-golf', 't-bs', 't-other'] });
    expect(next.filters.tagIds).toEqual(['t-golf', 't-bs']);
    expect(next.filters.q).toBe('an');
  });

  it('filters/pruneStaleTags không có id mồ côi (hoặc bộ lọc rỗng): trả nguyên state', () => {
    const state = createTestState();
    expect(crmReducer(state, { type: 'filters/pruneStaleTags', existingTagIds: [] })).toBe(state);
    const filtered = crmReducer(state, { type: 'filters/set', changes: { tagIds: ['t-golf'] } });
    expect(crmReducer(filtered, { type: 'filters/pruneStaleTags', existingTagIds: ['t-golf'] })).toBe(filtered);
  });

  it('session/setUser bỏ qua người dùng không tồn tại', () => {
    const state = createTestState();
    expect(crmReducer(state, { type: 'session/setUser', userId: 'ghost' })).toBe(state);
    expect(crmReducer(state, { type: 'session/setUser', userId: 'admin' }).session.currentUserId).toBe('admin');
  });
});
