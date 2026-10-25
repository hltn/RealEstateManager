import { afterEach, describe, expect, it } from 'vitest';
import { buildActor } from '@crm/api/access';
import { queryCustomers } from '@crm/api/queries';
import { createCrmStore, createSeedDataState } from './crmStore';
import { CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, loadCrmData, saveCrmData } from './crmStorage';

afterEach(() => window.localStorage.clear());

type Seed = ReturnType<typeof createSeedDataState>;
const seed = (): Seed => createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
const stored = (data: unknown) => window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data }));

describe('N4 payload v3 sai cấu trúc chi tiết -> fallback seed, không crash', () => {
  it('khách có criteria: {} bị loại RIÊNG (giữ khách lành); nạp store + listCustomers không crash', () => {
    const data = seed();
    stored({ ...data, customers: data.customers.map((customer, index) => (index === 0 ? { ...customer, criteria: {} } : customer)) });
    const loaded = loadCrmData();
    expect(loaded?.customers).toHaveLength(data.customers.length - 1);
    expect(loaded?.customers.some((customer) => customer.id === data.customers[0].id)).toBe(false);
    const state = createCrmStore().getState().state;
    expect(() => queryCustomers(state, buildActor(state.users[0], state.teams), { listGroup: 'ALL' })).not.toThrow();
    expect(queryCustomers(state, buildActor(state.users[0], state.teams), { listGroup: 'ALL' })).toHaveLength(data.customers.length - 1);
  });

  it('mọi khách đều hỏng -> không còn gì để giữ, rơi về seed', () => {
    const data = seed();
    stored({ ...data, customers: data.customers.map((customer) => ({ ...customer, criteria: {} })) });
    expect(loadCrmData()).toBeNull();
  });

  it.each([
    ['catalogs thiếu khoá statuses', (data: Seed) => ({ ...data, catalogs: { ...data.catalogs, statuses: undefined } })],
    ['settings sai kiểu', (data: Seed) => ({ ...data, settings: { staleCustomerDays: 'x' } })],
    ['nguồn khách sai cấu trúc', (data: Seed) => ({ ...data, catalogs: { ...data.catalogs, leadSources: [{ label: 'x' }] } })],
    ['user sai vai trò', (data: Seed) => ({ ...data, users: [{ ...data.users[0], role: 'ROOT' }] })],
    ['careTeam có phần tử null', (data: Seed) => ({ ...data, customers: [{ ...data.customers[0], careTeam: [null] }] })],
    ['status sai listGroup', (data: Seed) => ({ ...data, catalogs: { ...data.catalogs, statuses: [{ ...data.catalogs.statuses[0], listGroup: 'X' }] } })],
  ])('%s', (_name, mutate) => {
    stored(mutate(seed()));
    expect(loadCrmData()).toBeNull();
  });

  it('careLog / appointment / changeLog / đề nghị hỏng bị loại RIÊNG từng bản ghi, phần còn lại giữ nguyên (không rơi về seed)', () => {
    const data = seed();
    const brokenCareLog = { id: 'L-bad', customerId: 'CUST-001' };
    const brokenAppointment = { id: 'A-bad', customerId: 'CUST-001' };
    const brokenChangeLog = { id: 'C-bad', customerId: 'CUST-001', action: 5 };
    const brokenRequest = { id: 'R-bad', customerId: 'CUST-001' };
    stored({
      ...data,
      careLogs: [...data.careLogs, brokenCareLog],
      appointments: [...data.appointments, brokenAppointment],
      changeLogs: [...data.changeLogs, brokenChangeLog],
      careTeamRequests: [...data.careTeamRequests, brokenRequest],
    });
    const loaded = loadCrmData();
    expect(loaded?.customers).toHaveLength(data.customers.length);
    expect(loaded?.careLogs).toHaveLength(data.careLogs.length);
    expect(loaded?.appointments).toHaveLength(data.appointments.length);
    expect(loaded?.changeLogs).toHaveLength(data.changeLogs.length);
    expect(loaded?.careTeamRequests).toHaveLength(data.careTeamRequests.length);
    expect(loaded?.careLogs.some((log) => log.id === 'L-bad')).toBe(false);
  });

  it('dự án thiếu mã/tên bị loại riêng; các dự án còn lại giữ nguyên', () => {
    const data = seed();
    stored({ ...data, catalogs: { ...data.catalogs, projects: [...data.catalogs.projects, { id: 'proj-bad', name: 'Không mã' }] } });
    const loaded = loadCrmData();
    expect(loaded?.catalogs.projects).toHaveLength(data.catalogs.projects.length);
    expect(loaded?.catalogs.projects.some((project) => project.id === 'proj-bad')).toBe(false);
  });

  it('dữ liệu hợp lệ vẫn nạp được (không từ chối nhầm)', () => {
    stored(seed());
    expect(loadCrmData()?.customers.length).toBeGreaterThan(0);
  });
});

describe('C7 quota localStorage', () => {
  const failingSetItem = () => {
    throw new DOMException('full', 'QuotaExceededError');
  };

  it('saveCrmData báo lỗi QUOTA thay vì nuốt lỗi', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = failingSetItem;
    try {
      expect(saveCrmData(seed())).toEqual({ ok: false, reason: 'QUOTA' });
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('store gọi onPersistError khi ghi thất bại', () => {
    const errors: string[] = [];
    const store = createCrmStore({ initialData: seed(), onPersistError: (reason) => errors.push(reason) });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = failingSetItem;
    try {
      store.getState().dispatch({ type: 'settings/update', changes: { staleCustomerDays: 9 } });
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(errors).toEqual(['QUOTA']);
  });
});
