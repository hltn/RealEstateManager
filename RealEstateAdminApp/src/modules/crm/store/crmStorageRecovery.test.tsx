/** Hồi quy TB-n3: lệch nhẹ không mất dữ liệu; dữ liệu hỏng được sao lưu (tối đa 3 bản) trước khi nạp seed. */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryList } from '@crm/screens/CustomerDetail/components/HistoryList';
import { CrmProvider } from './CrmProvider';
import { createCrmStore, createSeedDataState } from './crmStore';
import { CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, loadCrmData } from './crmStorage';

afterEach(() => window.localStorage.clear());

type Seed = ReturnType<typeof createSeedDataState>;
const seed = (): Seed => createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
const stored = (data: unknown) => window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data }));
const backupKeys = () => Object.keys(window.localStorage).filter((key) => key.startsWith(`${CRM_STORAGE_KEY}_corrupt_`));

describe('trường thiếu có giá trị mặc định an toàn (không bỏ cả CSDL)', () => {
  it('khách thiếu occasions / version / tagIds / notes vẫn nạp được với mặc định', () => {
    const data = seed();
    const stripped = data.customers.map((customer) => {
      const { occasions: _o, version: _v, tagIds: _t, notes: _n, ...rest } = customer;
      return rest;
    });
    stored({ ...data, customers: stripped });
    const loaded = loadCrmData();
    expect(loaded?.customers).toHaveLength(data.customers.length);
    expect(loaded?.customers[0]).toMatchObject({ occasions: [], version: 1, tagIds: [], notes: '' });
    expect(backupKeys()).toHaveLength(0);
  });

  it('nhật ký thiếu images/nextAction vẫn nạp; images sai kiểu bị bỏ', () => {
    const data = seed();
    const { nextAction: _n, images: _i, ...bare } = data.careLogs[0];
    stored({ ...data, careLogs: [{ ...bare, images: 'không phải mảng' }, ...data.careLogs.slice(1)] });
    const loaded = loadCrmData();
    expect(loaded?.careLogs).toHaveLength(data.careLogs.length);
    expect(loaded?.careLogs[0].nextAction).toBeNull();
    expect(Array.isArray(loaded?.careLogs[0].images ?? [])).toBe(true);
  });
});

describe('changeLogs lệch cấu trúc không làm UI vỡ', () => {
  it('changeLogs [{ id: "x" }] (thiếu changes/ngày/người) -> nạp được, HistoryList không throw', () => {
    const data = seed();
    stored({ ...data, changeLogs: [{ id: 'x', customerId: 'CUST-001', action: 'CUSTOMER_UPDATED' }, ...data.changeLogs] });
    const store = createCrmStore({ initialSession: { currentUserId: 'admin' } });
    const entry = store.getState().state.changeLogs.find((log) => log.id === 'x');
    expect(entry?.changes).toEqual([]);
    expect(() =>
      render(
        <MemoryRouter>
          <CrmProvider store={store}>
            <HistoryList customerId="CUST-001" />
          </CrmProvider>
        </MemoryRouter>,
      ),
    ).not.toThrow();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('changeLog không có id bị loại thay vì làm hỏng cả dữ liệu', () => {
    const data = seed();
    stored({ ...data, changeLogs: [{ customerId: 'CUST-001' }, ...data.changeLogs] });
    expect(loadCrmData()?.changeLogs).toHaveLength(data.changeLogs.length);
  });

  it('đề nghị tham gia thiếu trường bắt buộc -> chỉ loại riêng đề nghị đó, giữ phần còn lại', () => {
    const data = seed();
    stored({ ...data, careTeamRequests: [{ id: 'R1', customerId: 'CUST-001' }] });
    const loaded = loadCrmData();
    expect(loaded?.careTeamRequests).toHaveLength(0);
    expect(loaded?.customers).toHaveLength(data.customers.length);
  });
});

describe('sao lưu dữ liệu hỏng trước khi nạp seed', () => {
  it('lưu bản sao `<key>_corrupt_<timestamp>` rồi xoá khoá chính', () => {
    window.localStorage.setItem(CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data: { ...seed(), customers: [{ id: 'hỏng' }] } }));
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
    const keys = backupKeys();
    expect(keys).toHaveLength(1);
    expect(window.localStorage.getItem(keys[0])).toContain('hỏng');
  });

  it('chỉ giữ tối đa 3 bản sao (xoá bản cũ nhất)', () => {
    for (let index = 1; index <= 5; index += 1) {
      window.localStorage.setItem(CRM_STORAGE_KEY, `{hỏng lần ${index}`);
      loadCrmData();
    }
    const keys = backupKeys();
    expect(keys).toHaveLength(3);
    const contents = keys.map((key) => window.localStorage.getItem(key)).join('|');
    expect(contents).toContain('lần 5');
    expect(contents).not.toContain('lần 1');
  });
});
