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
    const next = crmReducer(state, { type: 'customers/update', customerId: 'CUST-001', patch: { statusId: 'st-net' }, action: 'STATUS_CHANGED', meta: meta('thao') });
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
    const next = crmReducer(state, { type: 'customers/update', customerId: 'CUST-001', patch: { statusId: 'st-interested' }, action: 'STATUS_CHANGED', meta: meta() });
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

  it('chặn SĐT trùng (so sánh sau chuẩn hoá) và thiếu tên', () => {
    const state = createTestState();
    expect(crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-2', phone: '0912 345 678' }), meta: meta() })).toBe(state);
    expect(crmReducer(state, { type: 'customers/create', customer: newCustomer({ id: 'NEW-3', fullName: '  ' }), meta: meta() })).toBe(state);
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
    const filtered = crmReducer(state, { type: 'filters/set', changes: { listGroup: 'NET', projectIds: ['proj-1'], q: 'an' } });
    const reset = crmReducer(filtered, { type: 'filters/reset' });
    expect(reset.filters.listGroup).toBe('NET');
    expect(reset.filters.projectIds).toEqual([]);
    expect(reset.filters.q).toBe('');
  });

  it('session/setUser bỏ qua người dùng không tồn tại', () => {
    const state = createTestState();
    expect(crmReducer(state, { type: 'session/setUser', userId: 'ghost' })).toBe(state);
    expect(crmReducer(state, { type: 'session/setUser', userId: 'admin' }).session.currentUserId).toBe('admin');
  });
});
