import { describe, expect, it } from 'vitest';
import { SEED_CATALOGS } from '@crm/data/seedCatalogs';
import {
  createEmptyProject,
  diffProject,
  formatProjectPrice,
  getFirstProjectError,
  getProjectErrors,
  isValidProjectCode,
  listProjectFilterOptions,
  normalizeProject,
  parseLegacyPriceText,
  parseLegacyProjectStatus,
  PROJECT_STATUS_LABELS,
  suggestProjectCode,
  toProjectLabel,
  UNKNOWN_PROJECT_LABEL,
} from './projectRules';

const projects = SEED_CATALOGS.projects;
const valid = { ...createEmptyProject('p-new'), name: 'Sky Park', code: 'SKYPARK' };

describe('normalizeProject', () => {
  it('cắt khoảng trắng, mã viết hoa, tên đầy đủ mặc định = tên ngắn', () => {
    const saved = normalizeProject({ ...valid, name: ' Sky Park ', code: ' skp1 ', developer: '  ABC  ', fullName: ' ' });
    expect(saved).toMatchObject({ name: 'Sky Park', code: 'SKP1', fullName: 'Sky Park', developer: 'ABC' });
  });

  it('giá không phải số hữu hạn -> null', () => {
    expect(normalizeProject({ ...valid, priceFrom: Number.NaN, priceTo: Number.POSITIVE_INFINITY })).toMatchObject({ priceFrom: null, priceTo: null });
  });
});

describe('getProjectErrors', () => {
  it('hợp lệ khi có tên + mã không trùng; các trường khác tuỳ chọn', () => {
    expect(getProjectErrors(projects, valid)).toEqual({});
  });

  it('tên và mã bắt buộc', () => {
    const errors = getProjectErrors(projects, createEmptyProject('p-x'));
    expect(errors.name).toBeDefined();
    expect(errors.code).toBeDefined();
    expect(getFirstProjectError(errors)).toBe(errors.name);
  });

  it('trùng tên (không dấu, không phân biệt hoa thường) và trùng mã (không phân biệt hoa thường) với dự án khác', () => {
    const other = projects[0];
    expect(getProjectErrors(projects, { ...valid, name: other.name.toUpperCase() }).name).toContain('Đã có dự án');
    expect(getProjectErrors(projects, { ...valid, code: other.code.toLowerCase() }).code).toContain('đã tồn tại');
  });

  it('sửa chính dự án đó (cùng id) không bị coi là trùng; dự án đã ngừng hoặc đã xoá mềm vẫn giữ chỗ tên/mã', () => {
    const own = projects[0];
    expect(getProjectErrors(projects, own)).toEqual({});
    const inactive = projects.map((project) => (project.id === own.id ? { ...project, isActive: false } : project));
    expect(getProjectErrors(inactive, { ...valid, code: own.code }).code).toContain('đã tồn tại');
    const deleted = projects.map((project) => (project.id === own.id ? { ...project, isActive: false, deletedAt: '2026-10-22T00:00:00.000Z' } : project));
    expect(getProjectErrors(deleted, { ...valid, code: own.code }).code).toContain('đã tồn tại');
    expect(getProjectErrors(deleted, { ...valid, name: own.name }).name).toContain('Đã có dự án');
  });

  it('mã sai ký tự hoặc quá dài, trường dài quá bị báo', () => {
    expect(getProjectErrors(projects, { ...valid, code: 'SKY PARK' }).code).toBeDefined();
    expect(getProjectErrors(projects, { ...valid, code: 'X'.repeat(31) }).code).toBeDefined();
    expect(getProjectErrors(projects, { ...valid, code: 'X'.repeat(30) })).toEqual({});
    expect(getProjectErrors(projects, { ...valid, developer: 'x'.repeat(201) }).developer).toBeDefined();
  });

  it('giá: cho phép bỏ trống / chỉ 1 đầu / from = to; chặn from > to và giá âm', () => {
    expect(getProjectErrors(projects, { ...valid, priceFrom: null, priceTo: null })).toEqual({});
    expect(getProjectErrors(projects, { ...valid, priceFrom: 1_000_000_000, priceTo: null })).toEqual({});
    expect(getProjectErrors(projects, { ...valid, priceFrom: 2_000_000_000, priceTo: 2_000_000_000 })).toEqual({});
    expect(getProjectErrors(projects, { ...valid, priceFrom: 6_000_000_000, priceTo: 3_500_000_000 }).priceTo).toContain('lớn hơn hoặc bằng');
    expect(getProjectErrors(projects, { ...valid, priceFrom: -1 }).priceFrom).toBeDefined();
  });
});

describe('mã dự án: quy tắc mới (chữ + số viết liền) và mã cũ khi Sửa', () => {
  const legacy = { ...createEmptyProject('p-legacy'), name: 'Dự án cũ', code: 'OLD_CODE-1' };
  const withLegacy = [...projects, legacy];

  it.each(['SKY-PARK', 'SKY_PARK', 'SKY PARK', 'SKYPÁRK', 'SKY.PARK'])('Thêm mới: mã "%s" bị báo lỗi mẫu', (code) => {
    expect(getProjectErrors(projects, { ...valid, code }).code).toBe('Mã chỉ gồm chữ không dấu và số, viết liền, không có gạch ngang hoặc gạch dưới.');
  });

  it('Thêm mới: chữ thường được chấp nhận (chuẩn hoá HOA lúc lưu)', () => {
    expect(getProjectErrors(projects, { ...valid, code: 'skypark9' })).toEqual({});
  });

  it('Sửa dự án mã cũ có _ / -: không đổi mã (kể cả khác hoa/thường) thì không báo lỗi mẫu', () => {
    expect(getProjectErrors(withLegacy, legacy)).toEqual({});
    expect(getProjectErrors(withLegacy, { ...legacy, code: 'old_code-1' })).toEqual({});
    expect(getProjectErrors(withLegacy, { ...legacy, name: 'Tên mới' })).toEqual({});
  });

  it('Sửa dự án mã cũ: đổi sang mã cũ khác thì báo lỗi; đổi sang mã mới hợp lệ thì qua', () => {
    expect(getProjectErrors(withLegacy, { ...legacy, code: 'OTHER_OLD' }).code).toContain('chỉ gồm chữ không dấu và số');
    expect(getProjectErrors(withLegacy, { ...legacy, code: 'OLDCODE1' })).toEqual({});
  });

  it('originalCode tường minh: dự án đang sửa KHÔNG có trong `existing` vẫn được miễn lỗi mẫu khi mã không đổi', () => {
    expect(getProjectErrors(projects, legacy, { originalCode: 'OLD_CODE-1' })).toEqual({});
    expect(getProjectErrors(projects, legacy, { originalCode: 'old_code-1' })).toEqual({});
    // Không truyền originalCode và không có trong `existing` -> coi như mã mới, áp quy tắc mới.
    expect(getProjectErrors(projects, legacy).code).toContain('chỉ gồm chữ không dấu và số');
  });

  it('originalCode tường minh khác mã hiện tại -> áp quy tắc mới; ưu tiên hơn mã tìm theo id', () => {
    expect(getProjectErrors(projects, legacy, { originalCode: 'KHAC' }).code).toContain('chỉ gồm chữ không dấu và số');
    expect(getProjectErrors(withLegacy, legacy, { originalCode: 'KHAC' }).code).toContain('chỉ gồm chữ không dấu và số');
  });

  it('mã cũ của dự án KHÁC không được miễn: dự án mới dùng lại mã đó vẫn bị báo lỗi mẫu', () => {
    expect(getProjectErrors(withLegacy, { ...valid, code: 'OLD_CODE-1' }).code).toContain('chỉ gồm chữ không dấu và số');
  });

  it('mã cũ không đổi vẫn phải qua kiểm độ dài/trùng của dự án khác', () => {
    const clash = { ...legacy, code: projects[0].code };
    expect(getProjectErrors([...projects, { ...legacy, code: projects[0].code }], clash).code).toContain('đã tồn tại');
  });
});

describe('suggestProjectCode / isValidProjectCode', () => {
  it('bỏ dấu, bỏ khoảng trắng, viết hoa', () => {
    expect(suggestProjectCode('Sky Park', [])).toBe('SKYPARK');
    expect(suggestProjectCode('Căn hộ Đảo Kim Cương', [])).toBe('CANHODAOKIMCUONG');
    expect(suggestProjectCode('đường Đồng Khởi', [])).toBe('DUONGDONGKHOI');
  });

  it('bỏ mọi ký tự ngoài A-Z0-9 (gồm - _ . dấu nháy), giữ chữ số', () => {
    expect(suggestProjectCode("Q'Terra - Phase_2 (A.1)", [])).toBe('QTERRAPHASE2A1');
  });

  it('tên rỗng hoặc chỉ ký tự lạ -> DUAN', () => {
    expect(suggestProjectCode('', [])).toBe('DUAN');
    expect(suggestProjectCode('  ', [])).toBe('DUAN');
    expect(suggestProjectCode('!!! --- ___', [])).toBe('DUAN');
  });

  it('tên dài: cắt đúng 30 ký tự', () => {
    const code = suggestProjectCode('Một dự án có cái tên rất là dài dòng không tưởng nổi luôn', []);
    expect(code).toBe('MOTDUANCOCAITENRATLADAIDONGKHO');
    expect(code).toHaveLength(30);
  });

  it('trùng mã (không phân biệt hoa thường): thêm hậu tố số tăng dần, không gạch', () => {
    expect(suggestProjectCode('Sky Park', ['skypark'])).toBe('SKYPARK2');
    expect(suggestProjectCode('Sky Park', ['SKYPARK', 'skypark2'])).toBe('SKYPARK3');
    expect(suggestProjectCode('Sky Park', ['OTHER'])).toBe('SKYPARK');
    expect(suggestProjectCode('', ['DUAN'])).toBe('DUAN2');
  });

  it('hậu tố cắt phần gốc để tổng vẫn <= 30 ký tự (cả khi hậu tố 2 chữ số)', () => {
    const base = 'A'.repeat(30);
    expect(suggestProjectCode(base, [base])).toBe(`${'A'.repeat(29)}2`);
    const taken = [base, ...Array.from({ length: 8 }, (_, index) => `${'A'.repeat(29)}${index + 2}`)];
    const next = suggestProjectCode(base, taken);
    expect(next).toBe(`${'A'.repeat(28)}10`);
    expect(next).toHaveLength(30);
    expect(isValidProjectCode(next)).toBe(true);
  });

  it('mã gợi ý luôn hợp lệ theo mẫu', () => {
    ['', '!!!', 'Đảo Kim Cương', 'x'.repeat(100)].forEach((name) => expect(isValidProjectCode(suggestProjectCode(name, []))).toBe(true));
  });

  it('nhận ra mã hợp lệ / không hợp lệ (chữ + số viết liền, 1-30 ký tự)', () => {
    ['QTERRA', 'vhop', 'A1', '9', 'X'.repeat(30)].forEach((code) => expect(isValidProjectCode(code)).toBe(true));
    ['', ' ', 'A B', 'Ä', 'A.B', 'A-1', 'A_B', '-A', '_x', 'X'.repeat(31)].forEach((code) => expect(isValidProjectCode(code)).toBe(false));
  });
});

describe('chuyển dữ liệu cũ (giá, trạng thái)', () => {
  it.each([
    ['3,5 – 6 tỷ', 3_500_000_000, 6_000_000_000, 'TOTAL'],
    ['95 - 130 triệu/m²', 95_000_000, 130_000_000, 'PER_SQM'],
    ['2 tỷ', 2_000_000_000, 2_000_000_000, 'TOTAL'],
    ['8 - 5 tỷ', 5_000_000_000, 8_000_000_000, 'TOTAL'],
    // Đơn vị theo TỪNG số.
    ['800 triệu - 2 tỷ', 800_000_000, 2_000_000_000, 'TOTAL'],
    ['1,5 tỷ - 900 triệu', 900_000_000, 1_500_000_000, 'TOTAL'],
    // Dấu chấm hàng nghìn kiểu VN: 1.200 triệu = 1,2 tỷ (KHÔNG phải 1,2 triệu); 3.5 tỷ vẫn là số thập phân.
    ['1.200 triệu', 1_200_000_000, 1_200_000_000, 'TOTAL'],
    ['1.200 - 2.500 triệu', 1_200_000_000, 2_500_000_000, 'TOTAL'],
    ['3.5 tỷ', 3_500_000_000, 3_500_000_000, 'TOTAL'],
    ['2 tr', 2_000_000, 2_000_000, 'TOTAL'],
  ])('parse "%s"', (text, from, to, unit) => {
    expect(parseLegacyPriceText(text)).toEqual({ priceFrom: from, priceTo: to, priceUnit: unit });
  });

  it.each([
    ['từ 3 tỷ', 3_000_000_000, null],
    ['Giá đến 5 tỷ', null, 5_000_000_000],
    ['dưới 2 tỷ', null, 2_000_000_000],
  ])('một đầu "%s" -> chỉ điền đầu tương ứng', (text, from, to) => {
    expect(parseLegacyPriceText(text)).toMatchObject({ priceFrom: from, priceTo: to });
  });

  it.each(['liên hệ', '', '3 - 4 - 5 tỷ', '100', '1.200', '95 - 130', null, 42])('không parse được %j -> để trống, không ném lỗi', (text) => {
    expect(parseLegacyPriceText(text)).toEqual({ priceFrom: null, priceTo: null, priceUnit: 'TOTAL' });
  });

  it.each([
    ['Sắp mở bán', 'UPCOMING'],
    ['Chưa mở bán', 'UPCOMING'],
    ['CHƯA MỞ BÁN', 'UPCOMING'],
    ['Tạm ngừng mở bán', 'SOLD_OUT'],
    ['Ngừng bán', 'SOLD_OUT'],
    ['Đã ngừng mở bán', 'SOLD_OUT'],
    ['Chưa bàn giao', null],
    ['Đang mở bán Giai đoạn 2', 'SELLING'],
    ['Mở bán Vịnh Đảo', 'SELLING'],
    ['Đang vận hành', 'SOLD_OUT'],
    ['Sắp bàn giao', 'SOLD_OUT'],
    ['Hết hàng', 'SOLD_OUT'],
    ['Trạng thái lạ', null],
    ['', null],
  ])('trạng thái "%s" -> %s', (label, status) => {
    expect(parseLegacyProjectStatus(label)).toBe(status);
  });
});

describe('formatProjectPrice + diffProject', () => {
  it('định dạng khoảng giá theo đơn vị; trống -> rỗng', () => {
    expect(formatProjectPrice({ priceFrom: 3_500_000_000, priceTo: 6_000_000_000, priceUnit: 'TOTAL' })).toBe('3,5 tỷ – 6 tỷ');
    expect(formatProjectPrice({ priceFrom: 95_000_000, priceTo: 130_000_000, priceUnit: 'PER_SQM' })).toBe('95 triệu – 130 triệu/m²');
    expect(formatProjectPrice({ priceFrom: 2_000_000_000, priceTo: null, priceUnit: 'TOTAL' })).toBe('từ 2 tỷ');
    expect(formatProjectPrice({ priceFrom: null, priceTo: null, priceUnit: 'TOTAL' })).toBe('');
  });

  it('nhãn tiếng Việt của enum trạng thái', () => {
    expect(PROJECT_STATUS_LABELS).toEqual({ UPCOMING: 'Sắp mở bán', SELLING: 'Đang mở bán', SOLD_OUT: 'Hết hàng' });
  });

  it('diff chỉ liệt kê trường đổi, trạng thái/giá hiện bằng chữ; không đổi -> rỗng', () => {
    const before = projects[0];
    expect(diffProject(before, before, SEED_CATALOGS.areas)).toEqual([]);
    const after = { ...before, status: 'SOLD_OUT' as const, developer: 'Chủ đầu tư mới', priceTo: 140_000_000, isActive: false };
    expect(diffProject(before, after, SEED_CATALOGS.areas)).toEqual([
      { field: 'Chủ đầu tư', from: before.developer, to: 'Chủ đầu tư mới' },
      { field: 'Khoảng giá', from: '95 triệu – 130 triệu/m²', to: '95 triệu – 140 triệu/m²' },
      { field: 'Trạng thái bán hàng', from: 'Đang mở bán', to: 'Hết hàng' },
      { field: 'Đang hoạt động', from: 'Có', to: 'Không' },
    ]);
  });
});

describe('toProjectLabel / listProjectFilterOptions', () => {
  it('nhãn = tên ngắn; không có trong danh mục -> "Dự án đã ngừng"', () => {
    expect(toProjectLabel(projects, 'proj-1')).toBe("Q'Terra");
    expect(toProjectLabel(projects, 'proj-ghost')).toBe(UNKNOWN_PROJECT_LABEL);
  });

  it('lựa chọn lọc: hoạt động + ngừng-còn-khách ("ngừng"); bỏ ngừng-không-ai-gắn và xoá mềm', () => {
    const catalog = [
      { ...projects[0], id: 'a', name: 'Đang chạy', isActive: true },
      { ...projects[1], id: 'b', name: 'Ngừng còn khách', isActive: false },
      { ...projects[2], id: 'c', name: 'Ngừng không ai', isActive: false },
      { ...projects[3], id: 'd', name: 'Đã xoá', isActive: false, deletedAt: '2026-10-22T00:00:00.000Z' },
      { ...projects[4], id: 'e', name: 'Xoá mà vẫn bị gắn', isActive: false, deletedAt: '2026-10-22T00:00:00.000Z' },
    ];
    const options = listProjectFilterOptions(catalog, new Set(['b', 'e']));
    expect(options.map((option) => [option.value, option.label])).toEqual([
      ['a', 'Đang chạy'],
      ['b', 'Ngừng còn khách (ngừng)'],
    ]);
    expect(options[0].searchText).toContain(projects[0].fullName);
  });
});

