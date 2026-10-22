import { describe, expect, it } from 'vitest';
import { SEED_CATALOGS, SEED_USERS } from '@crm/data/seedCatalogs';
import { parseCsv, toCsv, UTF8_BOM } from './csv';
import { autoMapColumns, checkImportLimits, IMPORT_PRESETS, validateImportRows } from './importCustomers';

const DSKH = IMPORT_PRESETS[0];
const DROP = IMPORT_PRESETS.find((preset) => preset.code === 'DSKH_DROP')!;

describe('csv', () => {
  it('toCsv có BOM, bọc ô có dấu phẩy/ngoặc kép/xuống dòng', () => {
    const csv = toCsv([['Họ tên', 'Ghi chú'], ['Nguyễn "An"', 'a, b\nc']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('"Nguyễn ""An"""');
    expect(csv).toContain('"a, b\nc"');
  });

  it('parseCsv đọc lại đúng (khứ hồi), nhận dấu ; của Excel, bỏ dòng trống', () => {
    const rows = [['Họ tên', 'SĐT'], ['Trần "B"', '0912, 345'], ['Lê C', 'x\ny']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('Họ tên;SĐT\r\nAn;0912\r\n\r\n')).toEqual([['Họ tên', 'SĐT'], ['An', '0912']]);
  });
});

describe('importCustomers', () => {
  const headers = ['STT', 'Họ tên', 'SĐT', 'Nguồn', 'Dự án', 'Khu vực', 'NV chăm sóc', 'Ghi chú'];

  it('tự map cột theo tên (không dấu)', () => {
    const mapping = autoMapColumns(headers, DSKH);
    expect(mapping).toMatchObject({ fullName: 1, phone: 2, source: 3, projects: 4, area: 5, primaryAssignee: 6, notes: 7, status: -1 });
  });

  it('báo lỗi từng dòng: thiếu tên/SĐT, SĐT sai, trùng hệ thống, trùng trong file, danh mục chưa có', () => {
    const mapping = autoMapColumns(headers, DSKH);
    const rows = [
      ['1', 'Khách Hợp Lệ', '0900 111 001', 'Website STND', "Q'Terra; The Privia", 'Quận 7, TP.HCM', 'Trần Mỹ Hạnh', 'ok'],
      ['2', '', '0900 111 002', '', '', '', '', ''],
      ['3', 'SĐT sai', '123', '', '', '', '', ''],
      ['4', 'Trùng hệ thống', '0912 345 678', '', '', '', '', ''],
      ['5', 'Trùng file', '+84900111001', '', '', '', '', ''],
      ['6', 'Danh mục lạ', '0900 111 006', 'TikTok', 'The Rivus', 'Sao Hoả', 'Người Lạ', ''],
    ];
    const results = validateImportRows(rows, mapping, {
      catalogs: SEED_CATALOGS,
      users: SEED_USERS,
      existingPhones: new Set(['+84912345678']),
      preset: DSKH,
    });
    expect(results[0]).toMatchObject({ rowNumber: 2, errors: [], data: { phone: '+84900111001', sourceId: 'src-website', interestedProjectIds: ['proj-1', 'proj-2'], areaId: 'area-q7', primaryUserId: 'hanh', statusId: 'st-not-contacted' } });
    expect(results[1].errors).toContain('Thiếu họ tên');
    expect(results[2].errors[0]).toMatch(/SĐT không hợp lệ/);
    expect(results[3].errors).toContain('SĐT đã có trong hệ thống (trùng)');
    expect(results[4].errors).toContain('SĐT trùng với dòng 2 trong file');
    expect(results[5].errors).toEqual([
      'Nguồn khách chưa có trong danh mục: "TikTok"',
      'Khu vực chưa có trong danh mục: "Sao Hoả"',
      'Dự án chưa có trong danh mục: "The Rivus"',
      'Nhân viên chưa có trong hệ thống: "Người Lạ"',
    ]);
    expect(results.filter((result) => result.data).length).toBe(1);
  });

  it('preset DSKH_DROP gán tình trạng mặc định "Bỏ" khi file không có cột tình trạng', () => {
    const mapping = autoMapColumns(['Họ tên', 'SĐT'], DROP);
    const [result] = validateImportRows([['An', '0900111222']], mapping, { catalogs: SEED_CATALOGS, users: SEED_USERS, existingPhones: new Set(), preset: DROP });
    expect(result.data?.statusId).toBe('st-dropped');
  });
});

describe('C4 / N3 import: giới hạn, mục đã ẩn, nhân viên không hợp lệ', () => {
  const headers = ['Họ tên', 'SĐT', 'Nguồn', 'Dự án', 'Khu vực', 'Tình trạng', 'NV chăm sóc'];
  const mapping = autoMapColumns(headers, DSKH);
  const base = { catalogs: SEED_CATALOGS, users: SEED_USERS, existingPhones: new Set<string>(), preset: DSKH };
  const run = (row: string[], overrides: Partial<typeof base> = {}) => validateImportRows([row], mapping, { ...base, ...overrides })[0];

  it('checkImportLimits: quá 5 MB hoặc quá 5.000 dòng bị từ chối', () => {
    expect(checkImportLimits(5 * 1024 * 1024, 5000)).toBeNull();
    expect(checkImportLimits(5 * 1024 * 1024 + 1, 10)).toContain('quá lớn');
    expect(checkImportLimits(100, 5001)).toContain('Tối đa 5000 dòng');
  });

  it('giá trị danh mục đã ẩn -> lỗi dòng "đã ngừng dùng"', () => {
    const hidden = { ...SEED_CATALOGS, leadSources: SEED_CATALOGS.leadSources.map((source, index) => ({ ...source, isActive: index !== 0 })) };
    const result = run(['An', '0900111001', SEED_CATALOGS.leadSources[0].label, '', '', '', ''], { catalogs: hidden });
    expect(result.data).toBeNull();
    expect(result.errors.join('|')).toContain('đã ngừng dùng');
  });

  it('dự án / khu vực / tình trạng đã ẩn cũng bị chặn', () => {
    const hidden = {
      ...SEED_CATALOGS,
      projects: SEED_CATALOGS.projects.map((item) => ({ ...item, isActive: false })),
      areas: SEED_CATALOGS.areas.map((item) => ({ ...item, isActive: false })),
      statuses: SEED_CATALOGS.statuses.map((item) => (item.id === 'st-net' ? { ...item, isActive: false } : item)),
    };
    const result = run(['An', '0900111001', '', SEED_CATALOGS.projects[0].name, SEED_CATALOGS.areas[0].name, 'Khách net', ''], { catalogs: hidden });
    expect(result.errors.filter((error) => error.includes('đã ngừng dùng'))).toHaveLength(3);
  });

  it('nhân viên đã khoá hoặc ADMIN -> lỗi, không được làm phụ trách chính', () => {
    const locked = SEED_USERS.map((user) => (user.id === 'thao' ? { ...user, isActive: false } : user));
    expect(run(['An', '0900111001', '', '', '', '', 'Thảo'], { users: locked }).errors.join('|')).toContain('không thể phân chăm sóc');
    const admin = SEED_USERS.find((user) => user.role === 'ADMIN')!;
    expect(run(['An', '0900111001', '', '', '', '', admin.fullName]).data).toBeNull();
  });

  it('tên nhân viên trùng nhiều người -> báo mơ hồ thay vì chọn người đầu tiên', () => {
    const twin = { ...SEED_USERS.find((user) => user.id === 'thao')!, id: 'thao-2' };
    const result = run(['An', '0900111001', '', '', '', '', twin.fullName], { users: [...SEED_USERS, twin] });
    expect(result.data).toBeNull();
    expect(result.errors.join('|')).toContain('trùng nhiều người');
  });
});
