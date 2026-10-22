/** Vòng QA 2: nhãn dự án thống nhất, lựa chọn lọc theo dự án, giới hạn log, kiểm SĐT trùng khi nhập, CSV ký tự xuống dòng. */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UNKNOWN_PROJECT_LABEL } from '@crm/lib/projectRules';
import { crmReducer, MAX_AUDIT_LOGS, MAX_PHONE_VIEW_LOGS } from '@crm/store/crmReducer';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { selectCurrentUser } from '@crm/store/selectors';
import { createTestHarness, createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { buildActor } from './access';
import { getDashboardBreakdown } from './dashboard';
import { listDailyTasks } from './dailyTasks';
import { buildCustomerExport } from './exports';
import { usePhoneExists, useProjectFilterOptions } from './hooks';
import { listAppointments, listCustomers } from './queries';

describe('nhãn dự án: MỘT cách gọi ở list, dashboard, việc hôm nay, lịch hẹn và CSV', () => {
  it('dự án không còn trong danh mục -> cùng nhãn "Dự án đã ngừng" ở mọi nơi; dự án còn -> cùng tên ngắn', () => {
    const state = createTestState('admin');
    const customers = state.customers.map((customer) => (customer.id === 'CUST-001' ? { ...customer, interestedProjectIds: ['proj-ghost', 'proj-1'] } : customer));
    const patched = { ...state, customers };
    const actor = buildActor(selectCurrentUser(patched), patched.teams);
    const listLabels = listCustomers(patched, actor, { listGroup: 'ALL', limit: 100 }).data.find((item) => item.id === 'CUST-001')!.projects.map((ref) => ref.label);
    expect(listLabels).toEqual([UNKNOWN_PROJECT_LABEL, "Q'Terra"]);
    expect(getDashboardBreakdown(patched, actor, 'project').map((item) => item.key.label)).toEqual(expect.arrayContaining([UNKNOWN_PROJECT_LABEL, "Q'Terra"]));
    const taskLabels = listDailyTasks(patched, actor, { scope: 'team' }, FIXED_NOW).find((task) => task.customer.id === 'CUST-001')?.customer.projects.map((ref) => ref.label);
    expect(taskLabels).toEqual(listLabels);
    const appointmentLabels = listAppointments(patched, actor).find((row) => row.customer.id === 'CUST-001')?.customer.projects.map((ref) => ref.label);
    expect(appointmentLabels).toEqual(listLabels);
    const csv = buildCustomerExport(patched, actor, { listGroup: 'ALL', limit: 100 }, FIXED_NOW).content;
    expect(csv).toContain(`${UNKNOWN_PROJECT_LABEL}; Q'Terra`);
  });
});

const providerFor = (userId: string) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <CrmProvider store={store}>{children}</CrmProvider>
    </MemoryRouter>
  );
  return { store, wrapper };
};

describe('useProjectFilterOptions', () => {
  it('hiện dự án hoạt động + dự án đã ngừng mà còn khách (đánh dấu "ngừng"); bỏ dự án ngừng không ai gắn và dự án xoá mềm', () => {
    const { store, wrapper } = providerFor('admin');
    const { result, rerender } = renderHook(() => useProjectFilterOptions(), { wrapper });
    const state = () => store.getState().state;
    const isUsed = (projectId: string) => state().customers.some((customer) => customer.interestedProjectIds.includes(projectId));
    const used = state().catalogs.projects.find((project) => isUsed(project.id))!;
    const unused = state().catalogs.projects.find((project) => !isUsed(project.id))!;
    expect(unused).toBeDefined();
    const labelOf = (id: string) => result.current.find((option) => option.value === id)?.label;
    expect(labelOf(used.id)).toBe(used.name);
    const dispatch = store.getState().dispatch;
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: { ...used, isActive: false } });
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: { ...unused, isActive: false } });
    rerender();
    expect(labelOf(used.id)).toBe(`${used.name} (ngừng)`);
    expect(labelOf(unused.id)).toBeUndefined();
    dispatch({ type: 'catalogs/upsert', kind: 'projects', item: { ...used, isActive: false, deletedAt: '2026-10-22T00:00:00.000Z' } });
    rerender();
    expect(labelOf(used.id)).toBeUndefined();
  });
});

describe('usePhoneExists (kiểm SĐT trùng khi nhập file, không đọc danh sách số thô)', () => {
  it('nhận ra SĐT đã có theo mọi dạng chuẩn hoá; SĐT mới -> false; kể cả khách ngoài phạm vi người dùng', () => {
    const { wrapper } = providerFor('thao');
    const { result } = renderHook(() => usePhoneExists(), { wrapper });
    expect(result.current('+84912345678')).toBe(true);
    expect(result.current('0912 345 678')).toBe(true);
    expect(result.current('+84988333112')).toBe(true); // CUST-002 ngoài phạm vi của thao nhưng vẫn là số đã có
    expect(result.current('0911000999')).toBe(false);
    expect(result.current('abc')).toBe(false);
  });
});

describe('giới hạn kích thước log (prototype)', () => {
  it('auditLogs: giữ MAX_AUDIT_LOGS mục MỚI nhất', () => {
    const harness = createTestHarness('admin');
    let state = harness.getState();
    const log = (index: number) => ({ id: `AUD-${index}`, action: 'CUSTOMER_EXPORTED' as const, entityType: 'CUSTOMER_EXPORT' as const, entityId: null, actorId: 'admin', actorName: 'Admin', actorRole: 'ADMIN' as const, changes: [], createdAt: '2026-10-22T00:00:00.000Z' });
    for (let index = 0; index < MAX_AUDIT_LOGS + 5; index += 1) state = crmReducer(state, { type: 'auditLogs/add', log: log(index) });
    expect(state.auditLogs).toHaveLength(MAX_AUDIT_LOGS);
    expect(state.auditLogs[0].id).toBe(`AUD-${MAX_AUDIT_LOGS + 4}`);
    expect(state.auditLogs.some((entry) => entry.id === 'AUD-0')).toBe(false);
  });

  it('PHONE_VIEWED: chỉ giữ MAX_PHONE_VIEW_LOGS mục mới nhất, các loại log khác KHÔNG bị cắt', () => {
    const harness = createTestHarness('admin');
    const created = harness.api.createCustomer({ fullName: 'Có log khác', phone: '0911000321' });
    if (!created.ok) throw new Error('setup');
    const otherLogs = harness.getState().changeLogs.filter((entry) => entry.action !== 'PHONE_VIEWED').length;
    let state = harness.getState();
    for (let index = 0; index < MAX_PHONE_VIEW_LOGS + 5; index += 1) {
      state = crmReducer(state, { type: 'phones/viewed', customerId: created.data.id, meta: { actorId: 'admin', now: FIXED_NOW.toISOString(), changeLogId: `PV-${index}` } });
    }
    const phoneLogs = state.changeLogs.filter((entry) => entry.action === 'PHONE_VIEWED');
    expect(phoneLogs).toHaveLength(MAX_PHONE_VIEW_LOGS);
    expect(phoneLogs[0].id).toBe(`PV-${MAX_PHONE_VIEW_LOGS + 4}`);
    expect(state.changeLogs.filter((entry) => entry.action !== 'PHONE_VIEWED')).toHaveLength(otherLogs);
  });
});

