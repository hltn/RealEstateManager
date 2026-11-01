import { afterEach, describe, expect, it } from 'vitest';
import { createSeedDataState } from './crmStore';
import { CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, loadCrmData, saveCrmData } from './crmStorage';
import { createCrmStore } from './crmStore';

afterEach(() => window.localStorage.clear());

describe('crmStorage — version + migration an toàn', () => {
  it('lưu rồi đọc lại đúng dữ liệu v3', () => {
    const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    saveCrmData(data);
    expect(loadCrmData()?.customers.length).toBe(data.customers.length);
  });

  it('dữ liệu schema cũ (khoá v2, khách kiểu phẳng) bị dọn, trả null để nạp seed', () => {
    window.localStorage.setItem('stnd_crm_unified_v2', JSON.stringify({ customers: [{ id: 'CUST-001', name: 'An', status: 'Có quan tâm' }], careLogs: [], appointments: [], tasks: [] }));
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem('stnd_crm_unified_v2')).toBeNull();
  });

  it('sai version hoặc khách thiếu trường v3 -> null và xoá khoá hỏng', () => {
    const data = createSeedDataState();
    window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, data }));
    expect(loadCrmData()).toBeNull();
    const broken = { ...data, customers: [{ id: 'x', name: 'Kiểu cũ' }] };
    window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data: broken }));
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });

  it('JSON hỏng không làm crash', () => {
    window.localStorage.setItem(CRM_STORAGE_KEY, '{không phải json');
    expect(loadCrmData()).toBeNull();
  });

  it('createCrmStore: dữ liệu cũ không tương thích -> tự nạp seed mới, không lỗi', () => {
    window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, data: { customers: 'hỏng' } }));
    const store = createCrmStore();
    expect(store.getState().state.customers.length).toBeGreaterThan(0);
    expect(store.getState().state.customers.every((customer) => customer.phone.startsWith('+'))).toBe(true);
  });

  it('CCCD đầy đủ không nằm trong dữ liệu lưu localStorage chính', () => {
    const store = createCrmStore({ initialData: createSeedDataState() });
    expect(store.getState().state.customers.length).toBeGreaterThan(0);
    const raw = window.localStorage.getItem(CRM_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('079092001234');
    expect(raw).toContain('"nationalIdLast4":"1234"');
  });
});
