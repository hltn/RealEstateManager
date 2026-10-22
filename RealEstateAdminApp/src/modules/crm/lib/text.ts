/**
 * Xử lý chuỗi tiếng Việt dùng chung cho tìm kiếm (X3, tài liệu 01 §5 "tìm kiếm không phân biệt dấu").
 * Quy tắc giống backend (04 §3.2.3 `searchText`): bỏ dấu (NFD) + đ→d + chữ thường + gộp khoảng trắng.
 */

/** Mọi dấu kết hợp (combining mark) sau khi tách NFD, vd dấu sắc/huyền/mũ. */
const COMBINING_MARKS_PATTERN = /\p{M}/gu;

/** "Nguyễn Văn Đức" -> "nguyen van duc". */
export const normalizeVietnamese = (value: string): string =>
  value
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Chỉ giữ chữ số: "0912 345 678" -> "0912345678". */
export const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/**
 * So khớp từ khoá với 1 chuỗi theo kiểu "chứa", không phân biệt dấu/hoa thường.
 * Từ khoá rỗng luôn khớp.
 */
export const includesVietnamese = (haystack: string, keyword: string): boolean => {
  const normalizedKeyword = normalizeVietnamese(keyword);
  return !normalizedKeyword || normalizeVietnamese(haystack).includes(normalizedKeyword);
};

/** Slug ASCII cho mã danh mục: "Khu Đông TP.HCM" -> "khu_dong_tp_hcm". */
export const toSlug = (value: string): string =>
  normalizeVietnamese(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
