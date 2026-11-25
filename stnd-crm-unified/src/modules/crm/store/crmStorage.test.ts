import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedDataState } from './crmStore';
import { CRM_BACKUP_KEY_PREFIX, CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, isCrmDataState, loadCrmData, migrateV6ToV7, saveCrmData } from './crmStorage';

const NOW = new Date('2026-11-11T05:00:00Z');

/** Dữ liệu v6: khách chưa có `customerCode`, `createdAt` đảo thứ tự mảng để kiểm cấp mã theo thời gian. */
const buildV6Payload = () => {
  const data = createSeedDataState(NOW);
  const customers = data.customers.map(({ customerCode: _removed, ...rest }, index) => ({ ...rest, createdAt: `2026-01-${String(30 - index).padStart(2, '0')}T00:00:00.000Z` }));
  return { schemaVersion: 6, data: { ...data, customers } };
};

describe('crmStorage v7: validation', () => {
  it('chấp nhận khách phone null và customerCode null', () => {
    const data = createSeedDataState(NOW);
    const customers = data.customers.map((customer, index) => (index === 0 ? { ...customer, phone: null, customerCode: null } : customer));
    expect(isCrmDataState({ ...data, customers })).toBe(true);
  });

  it('chấp nhận khách cũ không có trường customerCode (chưa di trú)', () => {
    const data = createSeedDataState(NOW);
    const customers = data.customers.map(({ customerCode: _removed, ...rest }) => rest);
    expect(isCrmDataState({ ...data, customers })).toBe(true);
  });

  it('từ chối phone sai kiểu (số) hoặc customerCode sai kiểu', () => {
    const data = createSeedDataState(NOW);
    const [first, ...rest] = data.customers;
    expect(isCrmDataState({ ...data, customers: [{ ...first, phone: 123 }, ...rest] })).toBe(false);
    expect(isCrmDataState({ ...data, customers: [{ ...first, customerCode: 5 }, ...rest] })).toBe(false);
  });

  it('seed hiện tại hợp lệ và có khách không SĐT + hai khách trùng SĐT', () => {
    const data = createSeedDataState(NOW);
    expect(isCrmDataState(data)).toBe(true);
    expect(data.customers.some((customer) => customer.phone === null)).toBe(true);
    const phones = data.customers.map((customer) => customer.phone).filter(Boolean);
    expect(new Set(phones).size).toBeLessThan(phones.length);
  });
});

describe('migrateV6ToV7', () => {
  it('cấp mã tuần tự theo createdAt tăng dần, giữ nguyên SĐT, dựng lại searchText', () => {
    const migrated = migrateV6ToV7(buildV6Payload().data) as { customers: { id: string; phone: string | null; customerCode: string; createdAt: string; searchText: string }[] };
    const byTime = [...migrated.customers].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    expect(byTime.map((customer) => customer.customerCode)).toEqual(byTime.map((_, index) => `KH-${String(index + 1).padStart(6, '0')}`));
    const original = buildV6Payload().data.customers;
    migrated.customers.forEach((customer, index) => {
      expect(customer.phone).toBe((original[index] as { phone: string | null }).phone);
      expect(customer.searchText).toContain(customer.customerCode.toLowerCase());
    });
  });

  it('nối tiếp sau mã lớn nhất đã có, không đổi mã đã có', () => {
    const payload = buildV6Payload().data;
    const customers = payload.customers.map((customer, index) => (index === 0 ? { ...customer, customerCode: 'KH-000050' } : customer));
    const migrated = migrateV6ToV7({ ...payload, customers }) as { customers: { customerCode: string }[] };
    expect(migrated.customers[0].customerCode).toBe('KH-000050');
    const others = migrated.customers.slice(1).map((customer) => customer.customerCode);
    expect(others.every((code) => code > 'KH-000050')).toBe(true);
    expect(new Set(migrated.customers.map((customer) => customer.customerCode)).size).toBe(migrated.customers.length);
  });

  it('dữ liệu sai hình dạng được trả nguyên', () => {
    expect(migrateV6ToV7(null)).toBeNull();
    expect(migrateV6ToV7({ foo: 1 })).toEqual({ foo: 1 });
  });
});

describe('loadCrmData: nâng cấp v6 -> v7', () => {
  beforeEach(() => localStorage.clear());

  it('nâng cấp thay vì xóa: có mã khách, lưu lại v7, giữ bản v6 ở khóa backup', () => {
    const payload = buildV6Payload();
    const raw = JSON.stringify(payload);
    localStorage.setItem(CRM_STORAGE_KEY, raw);
    const loaded = loadCrmData();
    expect(loaded).not.toBeNull();
    expect(loaded?.customers).toHaveLength(payload.data.customers.length);
    expect(loaded?.customers.every((customer) => /^KH-\d{6}$/.test(customer.customerCode ?? ''))).toBe(true);
    expect(JSON.parse(localStorage.getItem(CRM_STORAGE_KEY) as string).schemaVersion).toBe(CRM_SCHEMA_VERSION);
    expect(localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}6`)).toBe(raw);
  });

  it('đọc lại lần hai (đã v7) không đổi mã và không tạo thêm backup', () => {
    localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify(buildV6Payload()));
    const first = loadCrmData();
    localStorage.removeItem(`${CRM_BACKUP_KEY_PREFIX}6`);
    const second = loadCrmData();
    expect(second?.customers.map((customer) => customer.customerCode)).toEqual(first?.customers.map((customer) => customer.customerCode));
    expect(localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}6`)).toBeNull();
  });

  it('khách phone null qua save rồi load vẫn null', () => {
    const data = createSeedDataState(NOW);
    expect(saveCrmData(data).ok).toBe(true);
    expect(loadCrmData()?.customers.find((customer) => customer.id === 'CUST-017')?.phone).toBeNull();
  });

  it('version cũ hơn v6 bị bỏ (trả null để nạp seed)', () => {
    localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ ...buildV6Payload(), schemaVersion: 5 }));
    expect(loadCrmData()).toBeNull();
    expect(localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });
});
