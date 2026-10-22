/** SĐT: mọi người xem được khách (kể cả thành viên nhóm) xem/gọi được; MỖI lần "Hiện số"/gọi/Zalo ghi 1 log PHONE_VIEWED; ngoài phạm vi = 404. */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContactActions } from '@crm/hooks/useContactActions';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { selectCurrentUser } from '@crm/store/selectors';
import { createTestHarness, createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { buildActor } from './access';
import { listDailyTasks } from './dailyTasks';
import { getCustomer, listAppointments, listCustomers } from './queries';

const actorOf = (userId: string) => {
  const state = createTestState(userId);
  return { state, actor: buildActor(selectCurrentUser(state), state.teams) };
};

const FULL_DIGITS = '912345678';

describe('contract: list/chi tiết/lịch hẹn/việc hôm nay CHỈ mang số đã che (phoneMasked)', () => {
  it.each(['thao', 'hanh', 'admin'])('%s: không có số đầy đủ ở bất kỳ response nào, kể cả phụ trách chính/quản lý', (userId) => {
    const { state, actor } = actorOf(userId);
    const item = listCustomers(state, actor, { listGroup: 'ALL', limit: 100 }).data.find((row) => row.id === 'CUST-001')!;
    const detail = getCustomer(state, actor, 'CUST-001')!;
    expect(item.phoneMasked).toBe('0912 345 •••');
    expect(detail.phoneMasked).toBe('0912 345 •••');
    expect(item).not.toHaveProperty('phone');
    expect(detail).not.toHaveProperty('phone');
    expect(JSON.stringify([item, detail])).not.toContain(FULL_DIGITS);
  });

  it('thành viên nhóm (thao): việc hôm nay và lịch hẹn của CUST-001 tồn tại và chỉ có số che', () => {
    const { state, actor } = actorOf('thao'); // thao là MEMBER của CUST-001
    const tasks = listDailyTasks(state, actor, { scope: 'mine' }, FIXED_NOW).filter((row) => row.customer.id === 'CUST-001');
    const appointments = listAppointments(state, actor).filter((row) => row.customer.id === 'CUST-001');
    expect(tasks.length).toBeGreaterThan(0);
    expect(appointments.length).toBeGreaterThan(0);
    [...tasks, ...appointments].forEach((row) => {
      expect(row.customer.phoneMasked).toBe('0912 345 •••');
      expect(row.customer).not.toHaveProperty('phone');
    });
    // Payload KHÔNG mang searchText/số đầy đủ (ô tìm xử lý ở lớp dữ liệu qua tham số q).
    expect(JSON.stringify(tasks)).not.toContain('searchText');
    expect(JSON.stringify(tasks)).not.toContain(FULL_DIGITS);
  });

  it('ô tìm "Việc hôm nay" xử lý ở API (q): tìm theo tên không dấu, nội dung việc, SĐT (≥ 3 chữ số, các biến thể) như tìm khách', () => {
    const { state, actor } = actorOf('thao');
    const all = listDailyTasks(state, actor, { scope: 'mine' }, FIXED_NOW).filter((row) => row.customer.id === 'CUST-001');
    expect(all.length).toBeGreaterThan(0);
    const found = (q: string) => listDailyTasks(state, actor, { scope: 'mine', q }, FIXED_NOW).filter((row) => row.customer.id === 'CUST-001').length;
    ['nguyen van an', 'NGUYEN', '0912345678', '912345678', '+84912345678', '0912 345', 'nguyen.vanan@example.com'].forEach((q) => expect(found(q)).toBe(all.length));
    ['0999999999', 'khong ton tai', '912399'].forEach((q) => expect(found(q)).toBe(0));
    // Khoảng trắng đầu/cuối không phải từ khoá; từ khoá rỗng = không lọc.
    expect(found('   ')).toBe(all.length);
    // Khách ngoài phạm vi vẫn không lọt vào kể cả khi tìm đúng SĐT của họ.
    expect(listDailyTasks(state, actor, { scope: 'mine', q: '0988333112' }, FIXED_NOW)).toHaveLength(0);
  });

  it('khách ngoài phạm vi không lộ gì (không tồn tại với người xem)', () => {
    const { state, actor } = actorOf('thao');
    expect(getCustomer(state, actor, 'CUST-002')).toBeNull();
    expect(JSON.stringify(listCustomers(state, actor, { listGroup: 'ALL', limit: 100 }))).not.toContain('988333112');
  });
});

describe('createPhoneView — kiểm quyền + ghi log', () => {
  it('thành viên nhóm: nhận số và mỗi lần xem ghi đúng 1 log PHONE_VIEWED kèm người xem', () => {
    const harness = createTestHarness('thao');
    const logsBefore = harness.getState().changeLogs.length;
    const result = harness.api.createPhoneView('CUST-001');
    expect(result.ok && result.data.phone).toBe('+84912345678');
    const added = harness.getState().changeLogs.slice(0, harness.getState().changeLogs.length - logsBefore);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ action: 'PHONE_VIEWED', customerId: 'CUST-001', actorId: 'thao' });
  });

  it('khách ngoài phạm vi: 404 và KHÔNG có log', () => {
    const harness = createTestHarness('thao');
    const logsBefore = harness.getState().changeLogs.length;
    const result = harness.api.createPhoneView('CUST-002');
    expect(!result.ok && result.error.statusCode).toBe(404);
    expect(harness.getState().changeLogs).toHaveLength(logsBefore);
  });

  it('phụ trách chính: nhận số và mỗi lần xem ghi 1 log PHONE_VIEWED', () => {
    const harness = createTestHarness('hanh');
    const first = harness.api.createPhoneView('CUST-001');
    expect(first.ok && first.data.phone).toBe('+84912345678');
    harness.api.createPhoneView('CUST-001');
    expect(harness.getState().changeLogs.filter((log) => log.action === 'PHONE_VIEWED')).toHaveLength(2);
  });

  it('ngoài phạm vi: 404', () => {
    const harness = createTestHarness('thao');
    const result = harness.api.createPhoneView('CUST-002');
    expect(!result.ok && result.error.statusCode).toBe(404);
  });
});

describe('useContactActions: cờ tắt -> tel: / zalo.me, qua lớp dữ liệu', () => {
  const originalLocation = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
    vi.restoreAllMocks();
  });

  const setup = (userId: string) => {
    const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <CrmProvider store={store}>{children}</CrmProvider>
      </MemoryRouter>
    );
    const location = { href: '' };
    Object.defineProperty(window, 'location', { value: location, writable: true });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    return { store, wrapper, location, open };
  };

  it('Gọi mở tel:, Zalo mở https://zalo.me/<sđt> và cả hai ghi log xem số', () => {
    const { store, wrapper, location, open } = setup('hanh');
    const { result } = renderHook(() => useContactActions(), { wrapper });
    result.current.callCustomer('CUST-001');
    expect(location.href).toBe('tel:+84912345678');
    result.current.messageZalo('CUST-001');
    expect(open.mock.calls[0]?.[0] ?? location.href).toContain('zalo.me/0912345678');
    expect(store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED')).toHaveLength(2);
    expect(store.getState().state.activeModal).toBeNull();
  });

  it('thành viên nhóm cũng gọi được và mỗi lần gọi ghi 1 log PHONE_VIEWED', () => {
    const { store, wrapper, location } = setup('thao');
    const { result } = renderHook(() => useContactActions(), { wrapper });
    result.current.callCustomer('CUST-001');
    expect(location.href).toBe('tel:+84912345678');
    expect(store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED' && log.actorId === 'thao')).toHaveLength(1);
  });

  it('khách ngoài phạm vi: không mở tel:/zalo.me và không ghi log', () => {
    const { store, wrapper, location, open } = setup('thao');
    const { result } = renderHook(() => useContactActions(), { wrapper });
    result.current.callCustomer('CUST-002');
    result.current.messageZalo('CUST-002');
    expect(location.href).toBe('');
    expect(open).not.toHaveBeenCalled();
    expect(store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED')).toHaveLength(0);
  });
});
