/** Hồi quy TB1: SĐT che ở lớp dữ liệu khi không có quyền; "Hiện số"/gọi/Zalo ghi log; fallback tel:/zalo.me khi tắt cờ. */
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

describe('TB1 lớp dữ liệu che SĐT khi không có quyền', () => {
  it('thành viên không phải phụ trách chính: danh sách/chi tiết/việc/lịch hẹn chỉ có số đã che', () => {
    const { state, actor } = actorOf('thao'); // thao là MEMBER của CUST-001
    const item = listCustomers(state, actor, { listGroup: 'ALL' }).data.find((row) => row.id === 'CUST-001')!;
    expect(item).toMatchObject({ phone: '0912 345 •••', isPhoneMasked: true });
    expect(getCustomer(state, actor, 'CUST-001')).toMatchObject({ phone: '0912 345 •••', isPhoneMasked: true });
    const task = listDailyTasks(state, actor, { scope: 'mine' }, FIXED_NOW).find((row) => row.customer.id === 'CUST-001');
    if (task) expect(task.customer).toMatchObject({ phone: '0912 345 •••', isPhoneMasked: true });
    const appointment = listAppointments(state, actor).find((row) => row.customer.id === 'CUST-001');
    if (appointment) expect(appointment.customer).toMatchObject({ phone: '0912 345 •••', isPhoneMasked: true });
    expect(JSON.stringify([item, task, appointment])).not.toContain('912345678');
  });

  it('phụ trách chính / quản lý nhận số đầy đủ', () => {
    const { state, actor } = actorOf('hanh');
    const item = listCustomers(state, actor, { listGroup: 'ALL' }).data.find((row) => row.id === 'CUST-001')!;
    expect(item).toMatchObject({ phone: '+84912345678', isPhoneMasked: false });
  });
});

describe('createPhoneView — kiểm quyền + ghi log', () => {
  it('thành viên thường: 403 và KHÔNG có log', () => {
    const harness = createTestHarness('thao');
    const logsBefore = harness.getState().changeLogs.length;
    const result = harness.api.createPhoneView('CUST-001');
    expect(!result.ok && result.error.errorCode).toBe('PHONE_FORBIDDEN');
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

  it('không có quyền xem số: không mở tel:/zalo.me', () => {
    const { wrapper, location, open } = setup('thao');
    const { result } = renderHook(() => useContactActions(), { wrapper });
    result.current.callCustomer('CUST-001');
    result.current.messageZalo('CUST-001');
    expect(location.href).toBe('');
    expect(open).not.toHaveBeenCalled();
  });
});
