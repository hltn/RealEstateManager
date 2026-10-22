/**
 * Quy tắc kiểm tra dữ liệu form khách hàng (dùng chung Thêm khách / Sửa hồ sơ). Hàm thuần -> dễ test.
 * QT3/QT9: chỉ Họ tên + SĐT bắt buộc; mọi trường khác tuỳ chọn (chỉ kiểm định dạng khi có nhập).
 * Trùng SĐT kiểm ở lớp dữ liệu (`lookupPhone`), không so khớp danh sách khách ở UI để không lộ thông tin (X2).
 */
import { isValidPhone } from '@crm/lib/phone';

/** Lỗi theo tên trường; trường hợp lệ không có khoá. */
export type FormErrors<TField extends string = string> = Partial<Record<TField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_FULL_NAME_LENGTH = 150;

/** Lỗi họ tên (bắt buộc, ≤ 150 ký tự). */
export const getFullNameError = (fullName: string): string | undefined => {
  const trimmed = fullName.trim();
  if (!trimmed) return 'Vui lòng nhập họ và tên khách hàng.';
  if (trimmed.length > MAX_FULL_NAME_LENGTH) return `Họ tên tối đa ${MAX_FULL_NAME_LENGTH} ký tự.`;
  return undefined;
};

/** Lỗi SĐT (bắt buộc + chuẩn hoá được về E.164). */
export const getPhoneFormatError = (phone: string): string | undefined => {
  if (!phone.trim()) return 'Vui lòng nhập số điện thoại khách hàng.';
  if (!isValidPhone(phone)) return 'Số điện thoại không hợp lệ (VD: 0912 345 678, số nước ngoài ghi dạng +...).';
  return undefined;
};

/** Email tuỳ chọn: rỗng = hợp lệ. */
export const isValidOptionalEmail = (email: string): boolean => !email.trim() || EMAIL_PATTERN.test(email.trim());

/** Thêm phần tử (đã trim) nếu chưa có; giữ nguyên mảng nếu rỗng/trùng. */
export const addUniqueItem = (items: readonly string[], value: string): string[] => {
  const trimmed = value.trim();
  return !trimmed || items.includes(trimmed) ? [...items] : [...items, trimmed];
};

export const toggleItem = (items: readonly string[], value: string): string[] =>
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

/** Thông báo lỗi đầu tiên (theo thứ tự khai báo trường) để hiện toast. */
export const getFirstError = <TField extends string>(errors: FormErrors<TField>, fieldOrder: readonly TField[]): string | undefined =>
  fieldOrder.map((field) => errors[field]).find(Boolean);
