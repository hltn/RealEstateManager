/**
 * Mã khách hàng `KH-000123` (v1.0.5, FR-02). Chỉ để HIỂN THỊ và tìm kiếm; khóa kỹ thuật vẫn là `id`.
 * Đệm 6 chữ số; vượt 999999 thì dài hơn (không cắt). Khách cũ chưa có mã -> `null`.
 */
const CODE_PREFIX = 'KH-';
const CODE_PATTERN = /^KH-(\d{6,})$/;

/** 123 -> "KH-000123". Số không hợp lệ (<1, không nguyên) -> null. */
export const formatCustomerCode = (sequence: number): string | null =>
  Number.isSafeInteger(sequence) && sequence >= 1 ? `${CODE_PREFIX}${String(sequence).padStart(6, '0')}` : null;

/** "KH-000123" -> 123. Sai mẫu -> null. */
export const parseCustomerCode = (code: string | null | undefined): number | null => {
  const match = code ? CODE_PATTERN.exec(code.trim().toUpperCase()) : null;
  return match ? Number(match[1]) : null;
};

/** Mã kế tiếp sau mã lớn nhất hiện có (mã `null`/sai mẫu bị bỏ qua). Chưa có mã nào -> "KH-000001". */
export const nextCustomerCode = (existingCodes: readonly (string | null | undefined)[]): string => {
  const max = existingCodes.reduce<number>((current, code) => Math.max(current, parseCustomerCode(code) ?? 0), 0);
  return formatCustomerCode(max + 1) ?? 'KH-000001';
};

/** Hiển thị mã; khách chưa có mã -> chuỗi rỗng (UI quyết định chữ thay thế). */
export const displayCustomerCode = (code: string | null | undefined): string => (code ? code : '');
