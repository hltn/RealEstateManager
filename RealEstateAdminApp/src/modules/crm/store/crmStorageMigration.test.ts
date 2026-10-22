/** Migration schema localStorage v3 -> v4 -> v5 + vá khách hỏng + sao lưu: an toàn với dữ liệu cũ, không rơi về seed vì 1 bản ghi hỏng. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchesCustomerFilters } from '@crm/api/queries';
import { buildSearchText } from '@crm/lib/customerRules';
import { resetNationalIdVaultForTest, revealNationalId, seedNationalIds } from '@crm/lib/nationalIdVault';
import { getProjectErrors, isValidProjectCode, PROJECT_NAME_MAX_LENGTH } from '@crm/lib/projectRules';
import { CRM_BACKUP_KEY_PREFIX, CRM_SCHEMA_VERSION, CRM_STORAGE_KEY, loadCrmData, saveCrmData } from './crmStorage';
import { createSeedDataState } from './crmStore';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const codeOf = (index: number) => `#${String(index + 1).padStart(2, '0')}`;
const corruptBackupKeys = () => Object.keys(window.localStorage).filter((key) => key.startsWith(`${CRM_STORAGE_KEY}_corrupt_`));

type Loose = Record<string, unknown>;

/** Dự án đúng như bản v4 từng lưu: `priceText`/`statusLabel` dạng chữ, chưa có `deletedAt`/enum; vài dự án mã rỗng/sai mẫu. */
const legacyProjects = (projects: Loose[]): Loose[] => {
  const legacy: { code?: string; priceText: string; statusLabel: string }[] = [
    { code: '', priceText: '3,5 – 6 tỷ', statusLabel: 'Sắp mở bán' },
    { code: 'mã sai!', priceText: 'liên hệ', statusLabel: 'Đang vận hành' },
    { priceText: '95 - 130 triệu/m²', statusLabel: 'Đang mở bán Giai đoạn 2' },
  ];
  return projects.map((project, index) => {
    const { priceFrom: _from, priceTo: _to, priceUnit: _unit, status: _status, deletedAt: _deleted, developer: _developer, propertyTypes: _types, ...rest } = project;
    const override = legacy[index] ?? { priceText: '', statusLabel: 'Trạng thái lạ' };
    return { ...rest, ...override, code: override.code ?? rest.code, propertyType: index === 0 ? 'Căn hộ' : '' };
  });
};

/** Dựng payload đúng như bản v3 từng lưu: khách có `code`, searchText chứa mã, status nhóm CARING, dự án dạng cũ. */
const buildV3Payload = () => {
  const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
  const customers = data.customers.map((customer, index) => ({ ...customer, code: codeOf(index), searchText: `${customer.searchText} ${codeOf(index)}` }));
  const statuses = [
    ...data.catalogs.statuses.map((status) => (status.listGroup === 'NOT_CONTACTED' || status.listGroup === 'INTERESTED' ? { ...status, listGroup: 'CARING' } : status)),
    { id: 'st-custom', code: 'DA_DAT_COC', label: 'Đã đặt cọc', listGroup: 'CARING', tone: 'brand', order: 9, isDefault: false, isSystem: false, isActive: true },
  ];
  const { auditLogs: _auditLogs, ...dataV3 } = data;
  const projects = legacyProjects(data.catalogs.projects as unknown as Loose[]);
  return { schemaVersion: 3, data: { ...dataV3, customers, catalogs: { ...data.catalogs, statuses, projects } } };
};

const store = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  window.localStorage.setItem(CRM_STORAGE_KEY, raw);
  return raw;
};

describe('migration v3 -> v4 (khách, tình trạng)', () => {
  it('phiên bản hiện tại là 5', () => {
    expect(CRM_SCHEMA_VERSION).toBe(5);
  });

  it('bỏ field code của mọi khách, giữ nguyên các field còn lại và số lượng', () => {
    const payload = buildV3Payload();
    store(payload);
    const loaded = loadCrmData();
    expect(loaded).not.toBeNull();
    expect(loaded?.customers).toHaveLength(payload.data.customers.length);
    loaded?.customers.forEach((customer, index) => {
      expect(customer).not.toHaveProperty('code');
      expect(customer.id).toBe(payload.data.customers[index].id);
      expect(customer.fullName).toBe(payload.data.customers[index].fullName);
    });
  });

  it('dựng lại searchText không còn mã khách (mọi biến thể): bằng đúng buildSearchText; tìm "#01" không ra, tên/SĐT/email vẫn ra', () => {
    const payload = buildV3Payload();
    payload.data.customers = payload.data.customers.map((customer, index) => ({ ...customer, searchText: `${customer.searchText} ${codeOf(index)} ${index + 1} #${index + 1} kh-${index + 1}` }));
    store(payload);
    const customers = loadCrmData()?.customers ?? [];
    customers.forEach((customer) => expect(customer.searchText).toBe(buildSearchText(customer)));
    expect(customers.filter((customer) => matchesCustomerFilters(customer, { q: '#01' }))).toHaveLength(0);
    const first = customers[0];
    expect(matchesCustomerFilters(first, { q: first.fullName })).toBe(true);
    expect(matchesCustomerFilters(first, { q: first.phone })).toBe(true);
    expect(matchesCustomerFilters(first, { q: first.email })).toBe(true);
  });

  it('email null / số / thiếu -> chuỗi rỗng, không làm hỏng cả CSDL', () => {
    const payload = buildV3Payload();
    const [first, second, third, ...rest] = payload.data.customers;
    const { email: _removed, ...withoutEmail } = third;
    payload.data.customers = [{ ...first, email: null }, { ...second, email: 12345 }, withoutEmail, ...rest] as unknown as typeof payload.data.customers;
    store(payload);
    const loaded = loadCrmData();
    expect(loaded?.customers).toHaveLength(payload.data.customers.length);
    expect(loaded?.customers.slice(0, 3).map((customer) => customer.email)).toEqual(['', '', '']);
  });

  it('tách CARING: Chưa tiếp cận (mặc định) -> NOT_CONTACTED, Có quan tâm -> INTERESTED, tình trạng tự thêm -> NOT_CONTACTED', () => {
    store(buildV3Payload());
    const statuses = loadCrmData()?.catalogs.statuses ?? [];
    const groupOf = (id: string) => statuses.find((status) => status.id === id)?.listGroup;
    expect(groupOf('st-not-contacted')).toBe('NOT_CONTACTED');
    expect(groupOf('st-interested')).toBe('INTERESTED');
    expect(groupOf('st-custom')).toBe('NOT_CONTACTED');
    expect(groupOf('st-net')).toBe('NET');
    expect(groupOf('st-dropped')).toBe('DROPPED');
    expect(statuses.some((status) => (status.listGroup as string) === 'CARING')).toBe(false);
  });

  it('tình trạng v3 KHÔNG có field code: không crash; nhận ra bằng id seed, còn lại về NOT_CONTACTED', () => {
    const payload = buildV3Payload();
    payload.data.catalogs.statuses = payload.data.catalogs.statuses.map((status) => {
      const { code: _code, ...withoutCode } = status as unknown as Loose;
      return withoutCode;
    }) as unknown as typeof payload.data.catalogs.statuses;
    store(payload);
    const statuses = loadCrmData()?.catalogs.statuses ?? [];
    expect(statuses.find((status) => status.id === 'st-interested')?.listGroup).toBe('INTERESTED');
    expect(statuses.find((status) => status.id === 'st-not-contacted')?.listGroup).toBe('NOT_CONTACTED');
    expect(statuses.find((status) => status.id === 'st-custom')?.listGroup).toBe('NOT_CONTACTED');
  });

  it('tình trạng mặc định cũ (dù mã INTERESTED) được đưa về NOT_CONTACTED để thoả quy tắc mặc định', () => {
    const payload = buildV3Payload();
    payload.data.catalogs.statuses = payload.data.catalogs.statuses.map((status) => ({ ...status, isDefault: status.id === 'st-interested' }));
    store(payload);
    const statuses = loadCrmData()?.catalogs.statuses ?? [];
    expect(statuses.find((status) => status.isDefault)?.listGroup).toBe('NOT_CONTACTED');
  });
});

describe('migration -> v5 (dự án, audit)', () => {
  it('giá/trạng thái dạng chữ -> số/enum; không parse được thì để trống; thêm deletedAt, developer, propertyTypes (mảng)', () => {
    store(buildV3Payload());
    const projects = loadCrmData()?.catalogs.projects ?? [];
    expect(projects[0]).toMatchObject({ priceFrom: 3_500_000_000, priceTo: 6_000_000_000, priceUnit: 'TOTAL', status: 'UPCOMING' });
    expect(projects[1]).toMatchObject({ priceFrom: null, priceTo: null, status: 'SOLD_OUT' });
    expect(projects[2]).toMatchObject({ priceFrom: 95_000_000, priceTo: 130_000_000, priceUnit: 'PER_SQM', status: 'SELLING' });
    expect(projects[3]).toMatchObject({ priceFrom: null, priceTo: null, status: null });
    projects.forEach((project) => {
      expect(project).toMatchObject({ deletedAt: null, developer: '' });
      expect(project).not.toHaveProperty('propertyType');
      expect(project).not.toHaveProperty('priceText');
      expect(project).not.toHaveProperty('statusLabel');
    });
    // Loại hình: chuỗi cũ -> mảng 1 phần tử; rỗng -> [].
    expect(projects[0].propertyTypes).toEqual(['Căn hộ']);
    expect(projects[1].propertyTypes).toEqual([]);
  });

  it('mã dự án rỗng/sai mẫu -> mã gợi ý từ tên, hợp lệ và không trùng; mã đang đúng giữ nguyên', () => {
    const payload = buildV3Payload();
    store(payload);
    const projects = loadCrmData()?.catalogs.projects ?? [];
    const original = payload.data.catalogs.projects as unknown as Loose[];
    projects.forEach((project) => expect(isValidProjectCode(project.code)).toBe(true));
    expect(new Set(projects.map((project) => project.code.toUpperCase())).size).toBe(projects.length);
    expect(projects[0].code).not.toBe('');
    expect(projects[2].code).toBe(original[2].code);
    expect(projects[0].code).toMatch(/^[A-Z0-9_-]+$/);
  });

  it('thêm auditLogs rỗng; dữ liệu v4 (đã có dự án kiểu cũ) cũng được chuyển lên v5', () => {
    const { auditLogs: _auditLogs, ...v4Data } = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    store({ schemaVersion: 4, data: { ...v4Data, catalogs: { ...v4Data.catalogs, projects: legacyProjects(v4Data.catalogs.projects as unknown as Loose[]) } } });
    const loaded = loadCrmData();
    expect(loaded?.auditLogs).toEqual([]);
    expect(loaded?.catalogs.projects[0]).toMatchObject({ status: 'UPCOMING', priceFrom: 3_500_000_000 });
  });

  it('dữ liệu v5 hiện tại đọc lại nguyên vẹn (không migrate lại)', () => {
    const data = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    saveCrmData(data);
    expect(loadCrmData()).toEqual(data);
    expect(window.localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}${CRM_SCHEMA_VERSION}`)).toBeNull();
  });
});

describe('sao lưu + ghi lại sau migration', () => {
  it('giữ nguyên văn bản v3 dưới khoá backup trước khi ghi đè; lần đọc sau cho cùng kết quả và payload mới ở v5', () => {
    const raw = store(buildV3Payload());
    const first = loadCrmData();
    expect(window.localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}3`)).toBe(raw);
    expect(JSON.parse(window.localStorage.getItem(CRM_STORAGE_KEY) ?? '{}').schemaVersion).toBe(CRM_SCHEMA_VERSION);
    expect(loadCrmData()).toEqual(first);
  });

  it('payload v3 thiếu catalogs / mọi khách sai kiểu: không crash, trả null, dọn khoá và lưu bản _corrupt_', () => {
    const payload = buildV3Payload();
    const raw = store({ schemaVersion: 3, data: { ...payload.data, catalogs: null } });
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
    expect(corruptBackupKeys().map((key) => window.localStorage.getItem(key))).toContain(raw);
    store({ schemaVersion: 3, data: { ...payload.data, customers: [null, 5, { id: 'x' }] } });
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });
});

describe('1 khách hỏng không làm cả CSDL về seed', () => {
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

  it('v5: giữ 49 khách lành, loại khách hỏng cùng dữ liệu con, lưu bản _corrupt_ và ghi lại bản đã vá', () => {
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

  it('v3: vừa migrate vừa vá — giữ cả bản v3 (backup) lẫn bản gốc (_corrupt_)', () => {
    const v3 = buildV3Payload();
    const fifty = buildFifty(0);
    const raw = store({ schemaVersion: 3, data: { ...v3.data, customers: fifty.customers, careLogs: fifty.careLogs, changeLogs: fifty.changeLogs } });
    const loaded = loadCrmData();
    expect(loaded?.customers).toHaveLength(49);
    expect(window.localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}3`)).toBe(raw);
    // Bản backup version đã là bản gốc nguyên văn -> KHÔNG ghi thêm bản _corrupt_ trùng nội dung (tối đa 1 bản sao mỗi lần nạp).
    expect(corruptBackupKeys()).toHaveLength(0);
    expect(loaded?.catalogs.statuses.some((status) => (status.listGroup as string) === 'CARING')).toBe(false);
  });

  it('hỏng ở phần không phải khách (vd danh sách người dùng) vẫn rơi về seed như cũ', () => {
    store({ schemaVersion: CRM_SCHEMA_VERSION, data: { ...buildFifty(3), users: 'hỏng' } });
    expect(loadCrmData()).toBeNull();
    expect(window.localStorage.getItem(CRM_STORAGE_KEY)).toBeNull();
  });
});

describe('migration v4 -> v5 vá dữ liệu cũ để sửa dự án không bị khoá', () => {
  const v4With = (projects: Loose[]) => {
    const { auditLogs: _auditLogs, ...v4Data } = createSeedDataState(new Date('2026-10-22T03:00:00.000Z'));
    return { schemaVersion: 4, data: { ...v4Data, catalogs: { ...v4Data.catalogs, projects } } };
  };
  const base = { fullName: '', developer: '', location: '', areaId: null, segment: '', isActive: true };

  it('mã trùng "dup","dup" (và khác hoa/thường) -> dự án sau được cấp mã mới; mã chữ thường -> chữ HOA; tất cả qua được getProjectErrors', () => {
    store(v4With([
      { ...base, id: 'p1', code: 'dup', name: 'Dự án A', priceText: '', statusLabel: '' },
      { ...base, id: 'p2', code: 'dup', name: 'Dự án B', priceText: '', statusLabel: '' },
      { ...base, id: 'p3', code: 'DUP', name: 'Dự án C', priceText: '', statusLabel: '' },
      { ...base, id: 'p4', code: 'chu_thuong-1', name: 'Dự án D', priceText: '', statusLabel: '' },
    ]));
    const projects = loadCrmData()?.catalogs.projects ?? [];
    expect(projects.map((project) => project.code)[0]).toBe('DUP');
    expect(projects[3].code).toBe('CHU_THUONG-1');
    expect(new Set(projects.map((project) => project.code)).size).toBe(4);
    projects.forEach((project) => {
      expect(isValidProjectCode(project.code)).toBe(true);
      expect(project.code).toBe(project.code.toUpperCase());
      // Không bị khoá: sửa/ngừng dự án cũ luôn qua được kiểm hợp lệ.
      expect(getProjectErrors(projects, project)).toEqual({});
    });
  });

  it('tên rỗng, quá dài, trùng (không dấu) được vá theo thứ tự', () => {
    store(v4With([
      { ...base, id: 'p1', code: 'A1', name: 'Sky Park', priceText: '', statusLabel: '' },
      { ...base, id: 'p2', code: 'A2', name: 'sky  PARK', priceText: '', statusLabel: '' },
      { ...base, id: 'p3', code: 'A3', name: '   ', fullName: 'Tên đầy đủ có sẵn', priceText: '', statusLabel: '' },
      { ...base, id: 'p4', code: 'A4', name: '', priceText: '', statusLabel: '' },
      { ...base, id: 'p5', code: 'A5', name: 'Rất dài '.repeat(30), priceText: '', statusLabel: '' },
    ]));
    const projects = loadCrmData()?.catalogs.projects ?? [];
    expect(projects[0].name).toBe('Sky Park');
    expect(projects[1].name).toBe('sky  PARK (2)');
    expect(projects[2].name).toBe('Tên đầy đủ có sẵn');
    expect(projects[3].name).toBe('A4');
    expect(projects[4].name.length).toBeLessThanOrEqual(PROJECT_NAME_MAX_LENGTH);
    projects.forEach((project) => expect(getProjectErrors(projects, project)).toEqual({}));
  });

  it('loại hình chuỗi cũ -> mảng 1 phần tử (không tách); chuỗi rỗng -> []; mảng sẵn có được chuẩn hoá', () => {
    store(v4With([
      { ...base, id: 'p1', code: 'A1', name: 'A', propertyType: 'Căn hộ / Shophouse', priceText: '', statusLabel: '' },
      { ...base, id: 'p2', code: 'A2', name: 'B', propertyType: '', priceText: '', statusLabel: '' },
      { ...base, id: 'p3', code: 'A3', name: 'C', propertyTypes: [' Nhà phố ', 'nhà phố', ''], priceFrom: null, priceTo: null, priceUnit: 'TOTAL', status: null },
    ]));
    const projects = loadCrmData()?.catalogs.projects ?? [];
    expect(projects.map((project) => project.propertyTypes)).toEqual([['Căn hộ / Shophouse'], [], ['Nhà phố']]);
  });
});

describe('sao lưu khi hết dung lượng (QUOTA)', () => {
  const OLD_BACKUP = `${CRM_BACKUP_KEY_PREFIX}2`;
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

  it('migration: ghi backup lỗi quota -> xoá bản sao cũ rồi thử lại; backup mới và dữ liệu v5 đều được ghi', () => {
    const raw = store(buildV3Payload());
    window.localStorage.setItem(OLD_BACKUP, 'bản cũ');
    window.localStorage.setItem(OLD_CORRUPT, 'bản hỏng cũ');
    simulateFullStorage();
    const loaded = loadCrmData();
    expect(loaded).not.toBeNull();
    expect(window.localStorage.getItem(`${CRM_BACKUP_KEY_PREFIX}3`)).toBe(raw);
    expect(window.localStorage.getItem(OLD_BACKUP)).toBeNull();
    expect(window.localStorage.getItem(OLD_CORRUPT)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(CRM_STORAGE_KEY) ?? '{}').schemaVersion).toBe(CRM_SCHEMA_VERSION);
  });

  it('quota kể cả sau khi xoá (đầy thật): vẫn trả dữ liệu đã migrate trong phiên, không ném lỗi', () => {
    store(buildV3Payload());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => loadCrmData()).not.toThrow();
    expect(loadCrmData()?.customers.length).toBeGreaterThan(0);
  });

  it('chỉ giữ 1 bản backup theo version: migrate lần nữa thay bản cũ thay vì thêm bản', () => {
    window.localStorage.setItem(OLD_BACKUP, 'v2 cũ');
    store(buildV3Payload());
    loadCrmData();
    const backups = Object.keys(window.localStorage).filter((key) => key.startsWith(CRM_BACKUP_KEY_PREFIX));
    expect(backups).toEqual([`${CRM_BACKUP_KEY_PREFIX}3`]);
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
