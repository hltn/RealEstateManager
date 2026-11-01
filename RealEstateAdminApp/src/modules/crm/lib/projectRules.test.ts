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
    const saved = normalizeProject({ ...valid, name: ' Sky Park ', code: ' skp-1 ', developer: '  ABC  ', fullName: ' ' });
    expect(saved).toMatchObject({ name: 'Sky Park', code: 'SKP-1', fullName: 'Sky Park', developer: 'ABC' });
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
    expect(getProjectErrors(projects, { ...valid, code: 'X'.repeat(21) }).code).toBeDefined();
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

describe('suggestProjectCode / isValidProjectCode', () => {
  it('sinh mã hợp lệ từ tên có dấu', () => {
    expect(suggestProjectCode('Căn hộ Sky Park', [])).toBe('CAN_HO_SKY_PARK');
    expect(isValidProjectCode(suggestProjectCode('Đảo Kim Cương', []))).toBe(true);
  });

  it('không trùng mã đã có (kể cả khác hoa/thường), thêm hậu tố và vẫn <= 20 ký tự', () => {
    expect(suggestProjectCode('Sky Park', ['sky_park'])).toBe('SKY_PARK-2');
    expect(suggestProjectCode('Sky Park', ['SKY_PARK', 'SKY_PARK-2'])).toBe('SKY_PARK-3');
    const long = suggestProjectCode('Một dự án có cái tên rất là dài dòng', ['MOT_DU_AN_CO_CAI_TEN']);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(isValidProjectCode(long)).toBe(true);
    expect(long).not.toBe('MOT_DU_AN_CO_CAI_TEN');
  });

  it('tên rỗng/toàn ký tự lạ -> mã dự phòng hợp lệ', () => {
    expect(isValidProjectCode(suggestProjectCode('', []))).toBe(true);
    expect(isValidProjectCode(suggestProjectCode('!!!', []))).toBe(true);
  });

  it('nhận ra mã hợp lệ / không hợp lệ', () => {
    // Mẫu doc: ^[A-Za-z0-9_-]{1,20}$ — cho phép ký tự đầu là _ hoặc -; chữ thường hợp lệ (lưu ép HOA).
    ['QTERRA', 'vhop', 'A-1', 'A_B', '-A', '_x', 'X'.repeat(20)].forEach((code) => expect(isValidProjectCode(code)).toBe(true));
    ['', ' ', 'A B', 'Ä', 'A.B', 'X'.repeat(21)].forEach((code) => expect(isValidProjectCode(code)).toBe(false));
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

