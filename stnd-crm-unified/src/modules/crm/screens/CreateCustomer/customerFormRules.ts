/**
 * Quy tắc kiểm tra dữ liệu form khách hàng (dùng chung cho Thêm khách / Cập nhật chân dung).
 * Hàm thuần, không đọc store -> dễ test.
 *
 * TODO(đề xuất): chuyển file này sang `src/lib/customerValidation.ts` khi được phép sửa `src/lib`.
 */
import type { Customer } from '@crm/types/crm';

/** Lỗi theo tên trường; trường hợp lệ không có khoá. */
export type FormErrors<TField extends string = string> = Partial<Record<TField, string>>;

/** Đầu số di động VN (03/05/07/08/09) + 8 số, hoặc máy bàn 02x + 9 số. */
const VN_MOBILE_PATTERN = /^0[35789]\d{8}$/;
const VN_LANDLINE_PATTERN = /^02\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTH_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Số ký tự tối thiểu để bắt đầu đối soát trùng SĐT (giống bản Mobile). */
export const MIN_PHONE_DIGITS_TO_CHECK = 9;
/** Số cuối CCCD còn hiển thị khi che. */

/** "+84 912-345-678" -> "0912345678" (bỏ ký tự lạ, đổi tiền tố 84 về 0). */
export const normalizePhoneDigits = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+84') || (digits.startsWith('84') && digits.length === 11)) {
    return `0${digits.slice(2)}`;
  }
  return digits;
};

export const isValidVnPhone = (phone: string): boolean => {
  const digits = normalizePhoneDigits(phone);
  return VN_MOBILE_PATTERN.test(digits) || VN_LANDLINE_PATTERN.test(digits);
};

/** Định dạng hiển thị chuẩn của dữ liệu: "0912 345 678" (10 số) / "0283 822 1234" (11 số). */
export const formatVnPhone = (phone: string): string => {
  const digits = normalizePhoneDigits(phone);
  if (digits.length !== 10 && digits.length !== 11) return phone.trim();
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
};

/**
 * Tìm khách khác đã dùng SĐT này (so sánh theo chữ số đã chuẩn hoá).
 * Bỏ qua khi SĐT còn quá ngắn; `excludeCustomerId` dùng cho form sửa (không tự trùng chính mình).
 */
export const findCustomerByPhone = <T extends Pick<Customer, 'id' | 'phone'>>(
  customers: readonly T[],
  phone: string,
  excludeCustomerId?: string,
): T | null => {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < MIN_PHONE_DIGITS_TO_CHECK) return null;
  return (
    customers.find(
      (customer) => customer.id !== excludeCustomerId && normalizePhoneDigits(customer.phone) === digits,
    ) ?? null
  );
};

/** Nội dung banner trùng SĐT theo tài liệu thiết kế: "Đã có khách này, do [tên] chăm sóc". */
export const getDuplicateOwnerText = (customer: Pick<Customer, 'staffLead'>): string =>
  `Đã có khách này, do ${customer.staffLead || 'chuyên viên khác'} chăm sóc`;

/** CCCD 12 số hoặc CMND cũ 9 số (cho phép khoảng trắng). Chuỗi rỗng = hợp lệ (không bắt buộc). */
export const isValidIdNumber = (idNumber: string): boolean => {
  const trimmed = idNumber.trim();
  if (!trimmed) return true;
  if (!/^[\d\s]+$/.test(trimmed)) return false;
  const length = trimmed.replace(/\s/g, '').length;
  return length === 12 || length === 9;
};

/** Email tuỳ chọn: rỗng = hợp lệ. */
export const isValidOptionalEmail = (email: string): boolean => !email.trim() || EMAIL_PATTERN.test(email.trim());

/** Ngày sinh dd/mm/yyyy có thật (kiểm tra cả 31/02...). */
export const isValidBirthDate = (value: string): boolean => {
  const match = BIRTH_DATE_PATTERN.exec(value.trim());
  if (!match) return false;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return (
    year >= 1900 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getTime() <= Date.now()
  );
};

/** Lỗi SĐT dùng chung (bắt buộc + định dạng VN + trùng). Trả `undefined` nếu hợp lệ. */
export const getPhoneError = (
  phone: string,
  customers: readonly Customer[],
  excludeCustomerId?: string,
): string | undefined => {
  if (!phone.trim()) return 'Vui lòng nhập số điện thoại khách hàng.';
  if (!isValidVnPhone(phone)) return 'Số điện thoại không hợp lệ (VD: 0912 345 678).';
  const duplicate = findCustomerByPhone(customers, phone, excludeCustomerId);
  if (duplicate) return `${getDuplicateOwnerText(duplicate)} (khách ${duplicate.name}).`;
  return undefined;
};

/** Bảo đảm giá trị hiện tại luôn có trong danh sách option của <select> (dữ liệu cũ ngoài danh sách). */
export const withCurrentOption = (options: readonly string[], current: string): string[] =>
  current && !options.includes(current) ? [current, ...options] : [...options];

/** Thêm phần tử (đã trim) nếu chưa có; giữ nguyên mảng nếu rỗng/trùng. */
export const addUniqueItem = (items: readonly string[], value: string): string[] => {
  const trimmed = value.trim();
  return !trimmed || items.includes(trimmed) ? [...items] : [...items, trimmed];
};

export const toggleItem = (items: readonly string[], value: string): string[] =>
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

/** Thông báo lỗi đầu tiên (theo thứ tự khai báo trường) để hiện toast. */
export const getFirstError = <TField extends string>(
  errors: FormErrors<TField>,
  fieldOrder: readonly TField[],
): string | undefined => fieldOrder.map((field) => errors[field]).find(Boolean);
