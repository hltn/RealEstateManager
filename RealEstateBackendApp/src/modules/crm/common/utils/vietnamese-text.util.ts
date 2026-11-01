/**
 * Chuẩn hóa chuỗi tiếng Việt để so khớp/tìm không dấu: bỏ dấu thanh/mũ, `đ -> d`,
 * chữ thường, gom khoảng trắng thừa. Dùng cho `nameNormalized` (khu vực...) và `q` tìm kiếm.
 */
export const normalizeVietnamese = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
