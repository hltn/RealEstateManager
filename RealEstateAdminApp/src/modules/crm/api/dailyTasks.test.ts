import { describe, expect, it } from 'vitest';
import { createTestHarness, createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { selectCurrentUser } from '@crm/store/selectors';
import { crmReducer } from '@crm/store/crmReducer';
import { buildActor } from './access';
import { getDashboardSummary } from './dashboard';
import { getDailyTaskSummary, getNextOccurrenceKey, getTaskGroup, listDailyTasks } from './dailyTasks';

const setup = (userId: string) => {
  const state = createTestState(userId);
  return { state, actor: buildActor(selectCurrentUser(state), state.teams) };
};

describe('getTaskGroup — theo ngày thực giờ VN', () => {
  it('trước hôm nay = Quá hạn, trong ngày = Hôm nay, trong N ngày = Sắp tới, xa hơn = không hiện', () => {
    // Biên ngày: 16:59Z = 23:59 ngày 21 (VN) -> quá hạn; 17:00Z = 00:00 ngày 22 (VN) -> hôm nay.
    expect(getTaskGroup('2026-10-21T16:59:00.000Z', '2026-10-22', 7)).toBe('OVERDUE');
    expect(getTaskGroup('2026-10-21T17:00:00.000Z', '2026-10-22', 7)).toBe('TODAY');
    expect(getTaskGroup('2026-10-21T10:00:00.000Z', '2026-10-22', 7)).toBe('OVERDUE');
    expect(getTaskGroup('2026-10-29T02:00:00.000Z', '2026-10-22', 7)).toBe('UPCOMING');
    expect(getTaskGroup('2026-10-30T02:00:00.000Z', '2026-10-22', 7)).toBeNull();
  });

  it('getNextOccurrenceKey: dịp đã qua trong năm -> năm sau; 29/02 năm thường -> 28/02', () => {
    expect(getNextOccurrenceKey(11, 15, '2026-10-22')).toBe('2026-11-15');
    expect(getNextOccurrenceKey(1, 5, '2026-10-22')).toBe('2027-01-05');
    expect(getNextOccurrenceKey(2, 29, '2026-10-22')).toBe('2027-02-28');
  });
});

describe('listDailyTasks', () => {
  it('việc của tôi gồm lịch hẹn, bước tiếp theo, dịp đặc biệt, khách lâu chưa chăm sóc — nhóm đúng ngày', () => {
    const { state, actor } = setup('hanh');
    const tasks = listDailyTasks(state, actor, {}, FIXED_NOW);
    const byId = (id: string) => tasks.find((task) => task.id === id);
    expect(byId('task-apt-APT-001')?.group).toBe('TODAY');
    expect(byId('task-apt-APT-004')?.group).toBe('UPCOMING');
    expect(byId('task-follow-LOG-010')?.group).toBe('TODAY');
    expect(byId('task-follow-LOG-014')?.group).toBe('UPCOMING'); // nhật ký hệ thống -> phụ trách chính nhận
    expect(tasks.some((task) => task.kind === 'OCCASION' && task.customer.id === 'CUST-004')).toBe(true);
    expect(tasks.some((task) => task.kind === 'STALE_CUSTOMER' && task.customer.id === 'CUST-006')).toBe(true);
    // Lịch của người khác không vào "việc của tôi".
    expect(byId('task-apt-APT-002')).toBeUndefined();
  });

  it('bước tiếp theo quá hạn của người cùng chăm sóc thuộc việc của họ', () => {
    const { state, actor } = setup('thao');
    const overdue = listDailyTasks(state, actor, {}, FIXED_NOW).filter((task) => task.group === 'OVERDUE');
    expect(overdue.map((task) => task.id)).toEqual(['task-follow-LOG-003']);
  });

  it('đánh dấu xong bước tiếp theo -> không còn trong danh sách', () => {
    const { state, actor } = setup('thao');
    const next = crmReducer(state, { type: 'followUps/complete', careLogId: 'LOG-003', meta: { actorId: 'thao', now: FIXED_NOW.toISOString(), changeLogId: 'c' } });
    expect(listDailyTasks(next, actor, {}, FIXED_NOW).some((task) => task.id === 'task-follow-LOG-003')).toBe(false);
  });

  it('tắt nhắc dịp đặc biệt của khách -> không sinh việc OCCASION (C13)', () => {
    const { state, actor } = setup('hanh');
    const next = crmReducer(state, {
      type: 'customers/update',
      customerId: 'CUST-004',
      patch: { shouldRemindOccasions: false },
      action: 'CUSTOMER_UPDATED',
      meta: { actorId: 'hanh', now: FIXED_NOW.toISOString(), changeLogId: 'c' },
    });
    expect(listDailyTasks(next, actor, {}, FIXED_NOW).some((task) => task.kind === 'OCCASION' && task.customer.id === 'CUST-004')).toBe(false);
  });

  it('nhắc trước N ngày theo cài đặt', () => {
    const { state, actor } = setup('hanh');
    const shortLead = { ...state, settings: { ...state.settings, occasionLeadDays: 1 } };
    expect(listDailyTasks(shortLead, actor, {}, FIXED_NOW).some((task) => task.kind === 'OCCASION' && task.customer.id === 'CUST-004')).toBe(false);
  });

  it('scope "team" chỉ cho Quản lý/Quản trị; nhân viên luôn "mine"', () => {
    const manager = setup('hanh');
    const mine = listDailyTasks(manager.state, manager.actor, { scope: 'mine' }, FIXED_NOW).length;
    const team = listDailyTasks(manager.state, manager.actor, { scope: 'team' }, FIXED_NOW).length;
    expect(team).toBeGreaterThan(mine);
    const staff = setup('thao');
    expect(listDailyTasks(staff.state, staff.actor, { scope: 'team' }, FIXED_NOW)).toEqual(listDailyTasks(staff.state, staff.actor, { scope: 'mine' }, FIXED_NOW));
  });

  it('getDailyTaskSummary đếm theo nhóm', () => {
    const { state, actor } = setup('hanh');
    const tasks = listDailyTasks(state, actor, {}, FIXED_NOW);
    const summary = getDailyTaskSummary(tasks);
    expect(summary.OVERDUE + summary.TODAY + summary.UPCOMING).toBe(tasks.length);
  });
});

describe('TB7 khách lâu chưa chăm sóc — một định nghĩa, ranh giới múi giờ VN', () => {
  const idleKinds = (lastCareLogAt: string, staleDays = 14) => {
    const harness = createTestHarness('admin');
    const state = harness.getState();
    const customer = state.customers.find((item) => item.id === 'CUST-010')!;
    const patched = {
      ...state,
      settings: { ...state.settings, staleCustomerDays: staleDays },
      customers: state.customers.map((item) => (item.id === customer.id ? { ...item, lastCareLogAt } : item)),
    };
    const actor = buildActor(patched.users.find((user) => user.id === 'admin')!, patched.teams);
    const tasks = listDailyTasks(patched, actor, { scope: 'team' }, FIXED_NOW).filter((task) => task.kind === 'STALE_CUSTOMER' && task.customer.id === customer.id);
    const dashboard = getDashboardSummary(patched, actor, {}, staleDays, FIXED_NOW).staleCustomers;
    const withoutCustomer = getDashboardSummary({ ...patched, customers: patched.customers.filter((item) => item.id !== customer.id) }, actor, {}, staleDays, FIXED_NOW).staleCustomers;
    return { hasTask: tasks.length > 0, dashboardCounts: dashboard - withoutCustomer === 1 };
  };

  it('16:59:59.999Z (còn ngày 8 giờ VN) đủ 14 ngày -> lâu chưa chăm sóc ở CẢ HAI nơi', () => {
    expect(idleKinds('2026-10-08T16:59:59.999Z')).toEqual({ hasTask: true, dashboardCounts: true });
  });

  it('17:00:00Z (đã sang ngày 9 giờ VN) mới 13 ngày -> KHÔNG ở cả hai nơi', () => {
    expect(idleKinds('2026-10-08T17:00:00.000Z')).toEqual({ hasTask: false, dashboardCounts: false });
  });
});

describe('getTaskGroup — ranh giới múi giờ VN', () => {
  const today = '2026-10-22';
  it('16:59:59.999Z (ngày 22 giờ VN, 23:59) vẫn là Hôm nay; 17:00:00Z (ngày 23) là Sắp tới', () => {
    expect(getTaskGroup('2026-10-22T16:59:59.999Z', today, 7)).toBe('TODAY');
    expect(getTaskGroup('2026-10-22T17:00:00.000Z', today, 7)).toBe('UPCOMING');
  });
  it('16:59:59.999Z ngày 21 (ngày 21 giờ VN) là Quá hạn; 17:00:00Z ngày 21 (ngày 22) là Hôm nay', () => {
    expect(getTaskGroup('2026-10-21T16:59:59.999Z', today, 7)).toBe('OVERDUE');
    expect(getTaskGroup('2026-10-21T17:00:00.000Z', today, 7)).toBe('TODAY');
  });
  it('mép cửa sổ Sắp tới: đúng 7 ngày còn hiện, 8 ngày thì ẩn', () => {
    expect(getTaskGroup('2026-10-29T10:00:00.000Z', today, 7)).toBe('UPCOMING');
    expect(getTaskGroup('2026-10-30T10:00:00.000Z', today, 7)).toBeNull();
  });
});
