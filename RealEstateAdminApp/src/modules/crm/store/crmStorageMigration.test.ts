/** Schema localStorage v6 (FR-40, T-16): bỏ dữ liệu v3-v5 lưu theo id cũ (không lỗi, giữ backup) + vá khách hỏng + sao lưu. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetNationalIdVaultForTest, revealNationalId, seedNationalIds } from '@crm/lib/nationalIdVault';
import { CRM_BACKUP_KEY_PREFIX, CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, loadCrmData, saveCrmData } from './crmStorage';
import { createSeedDataState } from './crmStore';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const corruptBackupKeys = () => Object.keys(window.localStorage).filter((key) => key.startsWith(`${CRM_STORAGE_KEY}_corrupt_`));

/** Payload đúng như bản v3-v5 từng lưu: seed nhưng catalog/khách tham chiếu bằng id cũ (st-*, ...). */
const buildLegacyPayload = (schemaVersion: 3 | 4 | 5) => {
  const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
  const statuses = data.catalogs.statuses.map((status) => ({ ...status, id: `st-${status.code.toLowerCase()}` }));
  const customers = data.customers.map((customer) => ({ ...customer, statusId: `st-${customer.statusId.toLowerCase()}` }));
  return { schemaVersion, data: { ...data, customers, catalogs: { ...data.catalogs, statuses } } };
};

const store = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  window.localStorage.setItem(CRM_STORAGE_KEY, raw);
  return raw;
};

describe('phiên bản 6: bỏ dữ liệu lưu theo id danh mục cũ (FR-40, T-16)', () => {
  it('phiên bản hiện tại là 6', () => {
    expect(CRM_SCHEMA_VERSION).toBe(6);
  });

  it.each([3, 4, 5] as const)('payload v%i (id cũ st-*): trả null để nạp seed, không ném lỗi, giữ nguyên văn bản dưới khoá backup', (version) => {
    const raw = store(buildLegacyPayload(version));
    expect(() => loadCrmData()).not.toThrow();
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}${version}`)).toBe(raw);
    expect(corruptBackupKeys()).toHaveLength(0);
  });

  it('payload v5: khoá CCCD mô phỏng không còn mục của khách cũ sau khi load', () => {
    const payload = buildLegacyPayload(5);
    const oldCustomerId = payload.data.customers[0].id;
    seedNationalIds({ [oldCustomerId]: '079123456789' });
    expect(revealNationalId(oldCustomerId)).not.toBeNull();
    store(payload);
    expect(loadCrmData()).toBeNull();
    expect(revealNationalId(oldCustomerId)).toBeNull();
    expect(window.localStorage.getItem('stnd_crm_pii_sim_v1') ?? '{}').not.toContain(oldCustomerId);
  });

  it('chỉ giữ 1 bản backup theo version: bỏ dữ liệu lần nữa thay bản cũ thay vì thêm bản', () => {
    window.localStorage.setItem(`${CRM_BACKUP_KEY_PREFIX}4`, 'v4 cũ');
    store(buildLegacyPayload(5));
    loadCrmData();
    const backups = Object.keys(window.localStorage).filter((key) => key.startsWith(CRM_BACKUP_KEY_PREFIX));
    expect(backups).toEqual([`${CRM_BACKUP_KEY_PREFIX}5`]);
  });

  it('createCrmStore sau khi bỏ dữ liệu v5: nạp seed mới theo code (id tình trạng = code), không còn id cũ', async () => {
    store(buildLegacyPayload(5));
    const { createCrmStore } = await import('./crmStore');
    const { statuses } = createCrmStore().getState().state.catalogs;
    expect(statuses.map((status) => status.id)).toEqual(statuses.map((status) => status.code));
    expect(JSON.stringify(createCrmStore().getState().state.customers)).not.toContain('st-');
  });

  it('payload v3-v5 hỏng cấu trúc (thiếu catalogs / khách sai kiểu) cũng không crash, trả null', () => {
    const { data } = buildLegacyPayload(3);
    store({ schemaVersion: 3, data: { ...data, catalogs: null } });
    expect(loadCrmData()).toBeNull();
    store({ schemaVersion: 4, data: { ...data, customers: [null, 5, { id: 'x' }] } });
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });

  it('schemaVersion lạ (< 3, thiếu, không phải số): coi là hỏng, lưu bản _corrupt_ và trả null', () => {
    const raw = store({ schemaVersion: 2, data: buildLegacyPayload(5).data });
    expect(loadCrmData()).toBeNull();
    expect(corruptBackupKeys().map((key) => window.localStorage.getItem(key))).toContain(raw);
    store({ data: {} });
    expect(loadCrmData()).toBeNull();
  });

  it('dữ liệu v6 hiện tại đọc lại nguyên vẹn, không tạo backup', () => {
    const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    saveCrmData(data);
    expect(loadCrmData()).toEqual(data);
    expect(Object.keys(window.localStorage).filter((key) => key.startsWith(CRM_BACKUP_KEY_PREFIX))).toEqual([]);
  });
});

describe('1 khách hỏng không làm cả CSDL về seed (v6)', () => {
  /** 50 khách (clone seed, id/SĐT khác nhau) + nhật ký/lịch hẹn/lịch sử trỏ tới khách, khách ở vị trí `brokenIndex` bị hỏng criteria. */
  const buildFifty = (brokenIndex: number) => {
    const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    const template = data.customers[0];
    const customers = Array.from({ length: 50 }, (_, index) => ({ ...template, id: `BULK-${index}`, fullName: `Khách ${index}`, phone: `+84900000${String(index).padStart(3, '0')}`, searchText: `khach ${index}` }));
    const careLog = data.careLogs[0];
    const careLogs = customers.map((customer, index) => ({ ...careLog, id: `LOG-${index}`, customerId: customer.id }));
    const changeLogs = [{ id: 'CHG-1', customerId: `BULK-${brokenIndex}`, action: 'CUSTOMER_UPDATED', actorId: 'admin', actorName: 'Admin', actorRole: 'ADMIN', changes: [], source: 'WEB', createdAt: '2026-10-01T00:00:00.000Z' }];
    const broken = customers.map((customer, index) => (index === brokenIndex ? { ...customer, criteria: null } : customer));
    return { ...data, customers: broken, careLogs, changeLogs, appointments: [], nationalIdViews: [], careTeamRequests: [] };
  };

  it('v6: giữ 49 khách lành, loại khách hỏng cùng dữ liệu con, lưu bản _corrupt_ và ghi lại bản đã vá', () => {
    const raw = store({ schemaVersion: CRM_SCHEMA_VERSION, data: buildFifty(7) });
    const loaded = loadCrmData();
    expect(loaded?.customers).toHaveLength(49);
    expect(loaded?.customers.some((customer) => customer.id === 'BULK-7')).toBe(false);
    expect(loaded?.careLogs).toHaveLength(49);
    expect(loaded?.careLogs.some((log) => log.customerId === 'BULK-7')).toBe(false);
    expect(loaded?.changeLogs).toHaveLength(0);
    expect(loaded?.catalogs.statuses.length).toBeGreaterThan(0);
    expect(corruptBackupKeys().map((key) => window.localStorage.getItem(key))).toEqual([raw]);
    expect(JSON.parse(window.localStorage.getItem(CRM_STORAGE_KEY) ?? '{}').data.customers).toHaveLength(49);
    // Lần đọc kế tiếp: dữ liệu đã sạch, không tạo thêm bản _corrupt_.
    expect(loadCrmData()?.customers).toHaveLength(49);
    expect(corruptBackupKeys()).toHaveLength(1);
  });

  it('hỏng ở phần không phải khách (vd danh sách người dùng) vẫn rơi về seed như cũ', () => {
    store({ schemaVersion: CRM_SCHEMA_VERSION, data: { ...buildFifty(3), users: 'hỏng' } });
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });
});

describe('sao lưu khi hết dung lượng (QUOTA)', () => {
  const OLD_BACKUP = `${CRM_BACKUP_KEY_PREFIX}4`;
  const OLD_CORRUPT = `${CRM_STORAGE_KEY}_corrupt_1`;

  /** Giả lập bộ nhớ đầy: mọi lần ghi khoá backup/_corrupt_/chính đều lỗi QUOTA CHO ĐẾN KHI các bản sao cũ bị xoá. */
  const simulateFullStorage = () => {
    const original = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      const isOldBackupPresent = this.getItem(OLD_BACKUP) !== null || this.getItem(OLD_CORRUPT) !== null;
      if (isOldBackupPresent && key !== OLD_BACKUP && key !== OLD_CORRUPT) throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    });
  };

  it('bỏ dữ liệu cũ: ghi backup lỗi quota -> xoá bản sao cũ rồi thử lại; backup mới được ghi, kết quả null', () => {
    const raw = store(buildLegacyPayload(5));
    window.localStorage.setItem(OLD_BACKUP, 'bản cũ');
    window.localStorage.setItem(OLD_CORRUPT, 'bản hỏng cũ');
    simulateFullStorage();
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}5`)).toBe(raw);
    expect(window.localStorage.getItem(OLD_BACKUP)).toBeNull();
    expect(window.localStorage.getItem(OLD_CORRUPT)).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });

  it('quota kể cả sau khi xoá (đầy thật): không ném lỗi, vẫn trả null để nạp seed', () => {
    store(buildLegacyPayload(5));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => loadCrmData()).not.toThrow();
    expect(loadCrmData()).toBeNull();
  });
});

describe('vá khách hỏng dọn kho CCCD mô phỏng', () => {
  it('CCCD của khách bị loại được xoá khỏi kho; CCCD khách còn sống giữ nguyên', () => {
    resetNationalIdVaultForTest();
    seedNationalIds({ 'BULK-7': '012345678901', 'BULK-8': '098765432109' });
    const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    resetNationalIdVaultForTest();
    seedNationalIds({ 'BULK-7': '012345678901', 'BULK-8': '098765432109' });
    const template = data.customers[0];
    const customers = Array.from({ length: 10 }, (_, index) => ({ ...template, id: `BULK-${index}`, phone: `+84900000${String(index).padStart(3, '0')}`, searchText: 'x', criteria: index === 7 ? null : template.criteria }));
    store({ schemaVersion: CRM_SCHEMA_VERSION, data: { ...data, customers, careLogs: [], appointments: [], changeLogs: [], nationalIdViews: [], careTeamRequests: [] } });
    expect(loadCrmData()?.customers).toHaveLength(9);
    expect(revealNationalId('BULK-7')).toBeNull();
    expect(revealNationalId('BULK-8')).toBe('098765432109');
    resetNationalIdVaultForTest();
  });
});
