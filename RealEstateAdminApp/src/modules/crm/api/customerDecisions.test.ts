/**
 * Các quyết định nghiệp vụ mới: email tùy chọn (validate định dạng), bỏ mã khách, tách nhóm Chưa tiếp cận / Có quan tâm,
 * SĐT thành viên nhóm xem/gọi được + log, tìm kiếm và lịch sử `changes` nhất quán.
 */
import { describe, expect, it } from 'vitest';
import { SEED_CATALOGS } from '@crm/data/seedCatalogs';
import { buildSearchText, isStaleCustomer, LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { createTestHarness, createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { selectCurrentUser } from '@crm/store/selectors';
import { buildActor } from './access';
import { getDashboardSummary } from './dashboard';
import { listDailyTasks } from './dailyTasks';
import { getCustomer, listCustomers, listHistories } from './queries';

const errorOf = (result: { ok: boolean; error?: { errorCode: string; message: string } }) => (result.ok ? null : result.error);

describe('email khách: tùy chọn, có nhập thì phải đúng định dạng', () => {
  it('tạo khách không email và email hợp lệ đều được; email sai bị 400', () => {
    const harness = createTestHarness('admin');
    expect(harness.api.createCustomer({ fullName: 'Không email', phone: '0911000001' }).ok).toBe(true);
    const withEmail = harness.api.createCustomer({ fullName: 'Có email', phone: '0911000002', email: ' an@example.com ' });
    expect(withEmail.ok && withEmail.data.email).toBe('an@example.com');
    expect(errorOf(harness.api.createCustomer({ fullName: 'Email sai', phone: '0911000003', email: 'khong-hop-le' }))?.errorCode).toBe('VALIDATION_FAILED');
    expect(harness.getState().customers.some((customer) => customer.fullName === 'Email sai')).toBe(false);
  });

  it('sửa hồ sơ (updateCustomer + saveCustomerProfile): email sai bị từ chối và KHÔNG ghi gì; xoá email (rỗng) được', () => {
    const harness = createTestHarness('hanh');
    const before = harness.getState().customers.find((customer) => customer.id === 'CUST-001')!;
    expect(errorOf(harness.api.updateCustomer('CUST-001', { version: before.version, email: 'a@b' }))?.errorCode).toBe('VALIDATION_FAILED');
    expect(errorOf(harness.api.saveCustomerProfile('CUST-001', { version: before.version, profile: { email: 'a b@c.vn' } }))?.errorCode).toBe('VALIDATION_FAILED');
    expect(harness.getState().customers.find((customer) => customer.id === 'CUST-001')).toEqual(before);
    const cleared = harness.api.updateCustomer('CUST-001', { version: before.version, email: '' });
    expect(cleared.ok && cleared.data.email).toBe('');
  });

  it('email vẫn nằm trong tìm kiếm', () => {
    const state = createTestState('admin');
    const actor = buildActor(selectCurrentUser(state), state.teams);
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: 'bich.tran@investor.vn' }).data.map((item) => item.id)).toEqual(['CUST-002']);
  });
});

describe('bỏ mã khách hàng', () => {
  it('khách tạo mới / danh sách / chi tiết không có field code; searchText không chứa mã', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createCustomer({ fullName: 'Khách mới', phone: '0911000010' });
    expect(created.ok && created.data).not.toHaveProperty('code');
    const stored = harness.getState().customers.find((customer) => customer.fullName === 'Khách mới')!;
    expect(stored).not.toHaveProperty('code');
    const state = harness.getState();
    const actor = buildActor(selectCurrentUser(state), state.teams);
    expect(listCustomers(state, actor, { listGroup: 'ALL', limit: 100 }).data.every((item) => !('code' in item))).toBe(true);
    expect(getCustomer(state, actor, 'CUST-001')).not.toHaveProperty('code');
    state.customers.forEach((customer) => expect(customer.searchText).not.toContain('#'));
  });

  it('tìm theo "#01" / "#1" không còn ra khách; buildSearchText chỉ gồm tên, SĐT, email', () => {
    const state = createTestState('admin');
    const actor = buildActor(selectCurrentUser(state), state.teams);
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: '#01' }).data).toHaveLength(0);
    expect(buildSearchText({ fullName: 'Nguyễn Văn An', phone: '+84912345678', email: 'A@B.vn' })).toBe('nguyen van an 0912345678 84912345678 912345678 a@b.vn');
  });
});

describe('tách nhóm Chưa tiếp cận / Có quan tâm (bỏ "Đang chăm sóc")', () => {
  const [notContacted, interested, net, dropped] = SEED_CATALOGS.statuses;
  const idleCustomer: { lastCareLogAt: string | null; createdAt: string } = { lastCareLogAt: null, createdAt: '2026-09-01T00:00:00.000Z' };

  it('nhãn nhóm: không còn "Đang chăm sóc"', () => {
    expect(Object.values(LIST_GROUP_LABELS)).toEqual(['Chưa tiếp cận', 'Có quan tâm', 'Khách net', 'Bỏ']);
  });

  it('khách lâu chưa chăm sóc: áp cho Chưa tiếp cận + Có quan tâm, không áp cho Net/Bỏ; ngưỡng tính đúng 14 ngày', () => {
    const statuses = SEED_CATALOGS.statuses;
    const stale = (statusId: string, customer = idleCustomer, days = 14) => isStaleCustomer({ ...customer, statusId }, statuses, days, FIXED_NOW);
    expect(stale(notContacted.id)).toBe(true);
    expect(stale(interested.id)).toBe(true);
    expect(stale(net.id)).toBe(false);
    expect(stale(dropped.id)).toBe(false);
    // 22/10 - 8/10 = đúng 14 ngày -> tính; 9/10 = 13 ngày -> chưa.
    expect(stale(interested.id, { lastCareLogAt: '2026-10-08T03:00:00.000Z', createdAt: idleCustomer.createdAt })).toBe(true);
    expect(stale(interested.id, { lastCareLogAt: '2026-10-09T03:00:00.000Z', createdAt: idleCustomer.createdAt })).toBe(false);
  });

  it('dashboard: byListGroup có 4 khoá và khớp tổng; staleCustomers chỉ đếm 2 nhóm đầu', () => {
    const state = createTestState('admin');
    const actor = buildActor(selectCurrentUser(state), state.teams);
    const summary = getDashboardSummary(state, actor, {}, 1, FIXED_NOW);
    expect(Object.keys(summary.byListGroup).sort()).toEqual(['DROPPED', 'INTERESTED', 'NET', 'NOT_CONTACTED']);
    const inTwoGroups = summary.byListGroup.NOT_CONTACTED + summary.byListGroup.INTERESTED;
    expect(summary.staleCustomers).toBeLessThanOrEqual(inTwoGroups);
    expect(summary.staleCustomers).toBeGreaterThan(0);
  });

  it('việc "khách lâu chưa chăm sóc" không xuất hiện cho khách Net/Bỏ', () => {
    const state = createTestState('admin');
    const actor = buildActor(selectCurrentUser(state), state.teams);
    const groupOf = (customerId: string) => state.catalogs.statuses.find((status) => status.id === state.customers.find((customer) => customer.id === customerId)?.statusId)?.listGroup;
    const staleTasks = listDailyTasks(state, actor, { scope: 'team' }, FIXED_NOW).filter((task) => task.kind === 'STALE_CUSTOMER');
    staleTasks.forEach((task) => expect(['NOT_CONTACTED', 'INTERESTED']).toContain(groupOf(task.customer.id)));
  });
});

describe('SĐT thành viên nhóm: xem + gọi, mỗi lần ghi log; tìm kiếm và lịch sử nhất quán', () => {
  it('thành viên nhóm (thao) tìm theo SĐT ra khách (searchText); kết quả chỉ mang số đã che', () => {
    const state = createTestState('thao');
    const actor = buildActor(selectCurrentUser(state), state.teams);
    const found = listCustomers(state, actor, { listGroup: 'ALL', q: '0912345678' }).data;
    expect(found.map((item) => item.id)).toEqual(['CUST-001']);
    expect(found[0].phoneMasked).toBe('0912 345 •••');
  });

  it('thành viên xem số -> log PHONE_VIEWED: quản lý thấy trong lịch sử, chính thành viên thì không thấy mục này', () => {
    const harness = createTestHarness('thao');
    expect(harness.api.createPhoneView('CUST-001').ok).toBe(true);
    expect(harness.api.createPhoneView('CUST-001').ok).toBe(true);
    const historiesFor = (userId: string) => {
      harness.switchUser(userId);
      const state = harness.getState();
      return listHistories(state, buildActor(selectCurrentUser(state), state.teams), 'CUST-001');
    };
    const asManager = historiesFor('hanh').filter((entry) => entry.action === 'PHONE_VIEWED');
    expect(asManager).toHaveLength(2);
    expect(asManager.every((entry) => entry.actor.id === 'thao')).toBe(true);
    expect(historiesFor('thao').some((entry) => entry.action === 'PHONE_VIEWED')).toBe(false);
  });

  it('lịch sử thay đổi SĐT hiện số đầy đủ cho người xem được khách (cùng quyền với danh sách)', () => {
    const harness = createTestHarness('hanh');
    const before = harness.getState().customers.find((customer) => customer.id === 'CUST-001')!;
    expect(harness.api.updateCustomer('CUST-001', { version: before.version, phone: '0912 345 679' }).ok).toBe(true);
    harness.switchUser('thao');
    const state = harness.getState();
    const actor = buildActor(selectCurrentUser(state), state.teams);
    const change = listHistories(state, actor, 'CUST-001').flatMap((entry) => entry.changes).find((item) => item.field === 'Số điện thoại');
    expect(change).toEqual({ field: 'Số điện thoại', from: '0912 345 678', to: '0912 345 679' });
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: '912345679' }).data.map((item) => item.id)).toEqual(['CUST-001']);
  });
});

describe('tab mặc định của danh sách khách', () => {
  it('mặc định là "Tất cả"; đặt lại bộ lọc giữ tab đang chọn', async () => {
    const { createInitialState, crmReducer, DEFAULT_FILTERS } = await import('@crm/store/crmReducer');
    expect(DEFAULT_FILTERS.listGroup).toBe('ALL');
    const initial = createInitialState(createTestState('admin'), { currentUserId: 'admin' });
    expect(initial.filters.listGroup).toBe('ALL');
    const picked = crmReducer(initial, { type: 'filters/set', changes: { listGroup: 'INTERESTED', q: 'an' } });
    expect(crmReducer(picked, { type: 'filters/reset' }).filters).toMatchObject({ listGroup: 'INTERESTED', q: '' });
  });
});
