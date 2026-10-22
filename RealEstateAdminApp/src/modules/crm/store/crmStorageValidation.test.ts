import { afterEach, describe, expect, it } from 'vitest';
import { buildActor } from '@crm/api/access';
import { listCustomers } from '@crm/api/queries';
import { createCrmStore, createSeedDataState } from './crmStore';
import { CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, loadCrmData, saveCrmData } from './crmStorage';

afterEach(() => window.localStorage.clear());

type Seed = ReturnType<typeof createSeedDataState>;
const seed = (): Seed => createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
const stored = (data: unknown) => window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data }));

describe('N4 payload v3 sai cấu trúc chi tiết -> fallback seed, không crash', () => {
  it('khách có criteria: {} bị loại; nạp store + listCustomers không crash', () => {
    const data = seed();
    stored({ ...data, customers: data.customers.map((customer, index) => (index === 0 ? { ...customer, criteria: {} } : customer)) });
    expect(loadCrmData()).toBeNull();
    const state = createCrmStore().getState().state;
    expect(() => listCustomers(state, buildActor(state.users[0], state.teams), { listGroup: 'ALL' })).not.toThrow();
  });

  it.each([
    ['catalogs thiếu khoá statuses', (data: Seed) => ({ ...data, catalogs: { ...data.catalogs, statuses: undefined } })],
    ['settings sai kiểu', (data: Seed) => ({ ...data, settings: { staleCustomerDays: 'x' } })],
    ['careLog thiếu content', (data: Seed) => ({ ...data, careLogs: [{ id: 'L', customerId: 'CUST-001' }] })],
    ['appointment thiếu startAt', (data: Seed) => ({ ...data, appointments: [{ id: 'A', customerId: 'CUST-001' }] })],
    ['user sai vai trò', (data: Seed) => ({ ...data, users: [{ ...data.users[0], role: 'ROOT' }] })],
    ['careTeam có phần tử null', (data: Seed) => ({ ...data, customers: [{ ...data.customers[0], careTeam: [null] }] })],
    ['status sai listGroup', (data: Seed) => ({ ...data, catalogs: { ...data.catalogs, statuses: [{ ...data.catalogs.statuses[0], listGroup: 'X' }] } })],
  ])('%s', (_name, mutate) => {
    stored(mutate(seed()));
    expect(loadCrmData()).toBeNull();
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
      store.getState().dispatch({ type: 'settings/update', changes: { upcomingDays: 9 } });
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(errors).toEqual(['QUOTA']);
  });
});
