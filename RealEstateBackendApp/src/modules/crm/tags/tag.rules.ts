import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';

/**
 * Làm sạch tên thẻ để hiển thị: NFKC (chữ rộng/biến thể tương thích về dạng chuẩn), bỏ ký tự định dạng vô hình
 * (`\p{Cf}`: zero-width, đánh dấu chiều chữ...) vốn dùng để tạo thẻ "giống hệt" nhưng khác khóa, cắt đầu cuối và
 * gom khoảng trắng thừa; giữ nguyên chữ hoa/dấu.
 */
export const cleanTagName = (name: string): string =>
  name
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Khóa so trùng của tên thẻ: không dấu, chữ thường, một khoảng trắng ("Kế  toán" và "ke toan" là một thẻ).
 * Cặp (category, nameNormalized) là duy nhất trong các thẻ chưa xóa.
 */
export const normalizeTagName = (name: string): string =>
  normalizeVietnamese(cleanTagName(name));

/** Phần khác nhau giữa hai tập id thẻ: cái mới thêm và cái bị gỡ (so theo chuỗi hex, không phụ thuộc thứ tự). */
export const diffTagIds = <T extends { toString(): string }>(
  before: readonly T[],
  after: readonly T[],
): { added: T[]; removed: T[] } => {
  const beforeSet = new Set(before.map(String));
  const afterSet = new Set(after.map(String));
  return {
    added: after.filter((id) => !beforeSet.has(String(id))),
    removed: before.filter((id) => !afterSet.has(String(id))),
  };
};
