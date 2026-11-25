import { normalizeVietnamese } from './vietnamese-text.util';

/** Mã khu vực (`areas.code`): chữ HOA ASCII, bắt đầu bằng chữ, tối đa 30 ký tự (Architecture 3.1, 5.1.4). */
export const AREA_CODE_MAX_LENGTH = 30;
/** Giới hạn an toàn của vòng thử hậu tố. */
const AREA_CODE_MAX_SUFFIX = 9999;
export const AREA_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

/**
 * Sinh mã gốc từ tên khu vực: bỏ dấu, chữ HOA, ký tự không phải chữ/số thành `_` (gộp liên tiếp, bỏ `_` đầu/cuối),
 * cắt <= 30 ký tự, bắt đầu bằng chữ (nếu không thì thêm tiền tố `A_`). Hàm thuần, xác định.
 * Ví dụ: "Hà Nội" -> `HA_NOI`; "12 Nguyễn Huệ" -> `A_12_NGUYEN_HUE`.
 */
export const generateAreaCode = (name: string): string => {
  let base = normalizeVietnamese(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') return 'A';
  if (!/^[A-Z]/.test(base)) base = `A_${base}`;
  return base.slice(0, AREA_CODE_MAX_LENGTH).replace(/_+$/, '');
};

/**
 * Chọn mã chưa bị dùng: trùng thì thêm hậu tố `_2`, `_3`... (vẫn giữ <= 30 ký tự bằng cách cắt phần gốc).
 * `taken` gồm cả mã của bản đã xóa mềm (mã không bao giờ được dùng lại).
 */
export const pickUniqueAreaCode = (
  base: string,
  taken: ReadonlySet<string>,
): string => {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= AREA_CODE_MAX_SUFFIX; n += 1) {
    const suffix = `_${n}`;
    const head = base
      .slice(0, AREA_CODE_MAX_LENGTH - suffix.length)
      .replace(/_+$/, '');
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Không tìm được mã khu vực trống cho "${base}"`);
};

/**
 * Tiền tố đủ dài để một truy vấn `^prefix` bắt được mọi biến thể `pickUniqueAreaCode` có thể sinh từ `base`
 * (kể cả khi phần gốc bị cắt để nhường chỗ cho hậu tố tới `_9999`).
 */
export const areaCodeSearchPrefix = (base: string): string =>
  base.slice(0, AREA_CODE_MAX_LENGTH - 5).replace(/_+$/, '') || base;
