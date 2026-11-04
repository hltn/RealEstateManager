/**
 * Chuẩn hoá SĐT theo tài liệu 04 §3.2.1 (X2, QT4): lưu E.164 (`+84912345678`), FE tự định dạng khi hiển thị.
 * Bản prototype tự viết (không dùng libphonenumber-js) cho số Việt Nam; số nước ngoài phải có dấu `+`.
 */
import { digitsOnly } from './text';

/** Đầu số di động 11 số cũ -> 10 số mới (chuyển đổi 2018), áp dụng cả khi nhập tay và import. */
const LEGACY_PREFIX_MAP: Record<string, string> = {
  '0162': '032', '0163': '033', '0164': '034', '0165': '035', '0166': '036', '0167': '037', '0168': '038', '0169': '039',
  '0120': '070', '0121': '079', '0122': '077', '0126': '076', '0128': '078',
  '0123': '083', '0124': '084', '0125': '085', '0127': '081', '0129': '082',
  '0186': '056', '0188': '058', '0199': '059',
};

/** Di động VN 10 số (03/05/07/08/09) hoặc máy bàn 02x 11 số, dạng nội địa có số 0 đầu. */
const VN_LOCAL_PATTERN = /^(0[35789]\d{8}|02\d{9})$/;
/** E.164 quốc tế: + và 8–15 chữ số. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Mã nước có số 0 trung gian ("trunk 0") khi viết quốc tế: +44 07911… thực chất là +44 7911… */
const TRUNK_ZERO_COUNTRY_CODES = ['44', '49', '33', '61', '81', '82', '86', '66', '60', '62'];

const stripForeignTrunkZero = (internationalDigits: string): string => {
  const code = TRUNK_ZERO_COUNTRY_CODES.find((candidate) => internationalDigits.startsWith(candidate));
  return code && internationalDigits.charAt(code.length) === '0' ? `${code}${internationalDigits.slice(code.length + 1)}` : internationalDigits;
};

/** Tách tiền tố quốc tế ("+" hoặc "00"): trả chữ số sau tiền tố, hoặc null nếu là số nội địa. */
const splitInternational = (input: string): string | null => {
  const trimmed = input.trim();
  const digits = digitsOnly(trimmed);
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  return null;
};

/**
 * Đổi chuỗi người dùng nhập sang dạng nội địa VN "0xxxxxxxxx"; null nếu không khớp mẫu VN.
 * Chấp nhận: "0912 345 678", "+84 912-345-678", "+84 0912...", "0084912...", "84912345678", "(0162) 123 4567".
 * Số 0 thừa ngay sau mã nước (+84 0912...) bị bỏ để không tạo ra SĐT "khác" cho cùng một người.
 */
const toVietnameseLocal = (input: string): string | null => {
  const international = splitInternational(input);
  let digits = digitsOnly(input);
  if (international !== null) {
    if (!international.startsWith('84')) return null;
    digits = international.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    digits = `0${digits}`;
  } else if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    digits = `0${digits}`;
  }
  const legacyPrefix = digits.length === 11 ? LEGACY_PREFIX_MAP[digits.slice(0, 4)] : undefined;
  if (legacyPrefix) digits = `${legacyPrefix}${digits.slice(4)}`;
  return VN_LOCAL_PATTERN.test(digits) ? digits : null;
};

/**
 * Chuẩn hoá về E.164. Trả `null` nếu không hợp lệ (backend trả 400 `INVALID_PHONE`).
 * Số VN -> "+84..."; số mang mã +84/0084 mà sai mẫu VN bị chặn; số nước ngoài cần "+" hoặc "00" và đúng E.164.
 */
export const normalizePhone = (input: string): string | null => {
  // Chỉ chấp nhận chữ số, khoảng trắng, ( ) . + - — còn ký tự khác (chữ, dấu nháy...) là sai (không "lọc ngầm" thành số).
  if (/[^\d\s().+-]/.test(input)) return null;
  const local = toVietnameseLocal(input);
  if (local) return `+84${local.slice(1)}`;
  const international = splitInternational(input);
  if (international === null || international.startsWith('84')) return null;
  const e164 = `+${stripForeignTrunkZero(international)}`;
  return E164_PATTERN.test(e164) ? e164 : null;
};

export const isValidPhone = (input: string): boolean => normalizePhone(input) !== null;

/** "+84912345678" -> "0912 345 678"; máy bàn 11 số -> "0283 822 1234"; số nước ngoài giữ E.164. */
export const formatPhoneDisplay = (phone: string): string => {
  const normalized = normalizePhone(phone);
  if (!normalized) return phone.trim();
  if (!normalized.startsWith('+84')) return normalized;
  const local = `0${normalized.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
};

/** Dạng nội địa không khoảng trắng để gọi/Zalo: "+84912345678" -> "0912345678". */
export const toLocalDigits = (phone: string): string => {
  const normalized = normalizePhone(phone);
  if (normalized?.startsWith('+84')) return `0${normalized.slice(3)}`;
  return digitsOnly(phone);
};

/**
 * Các biến thể chữ số đưa vào `searchText` để tìm theo SĐT (04 §3.2.3): "0912345678", "84912345678", "912345678".
 */
export const getPhoneSearchVariants = (phone: string): string[] => {
  const normalized = normalizePhone(phone);
  if (!normalized) return [digitsOnly(phone)].filter(Boolean);
  const international = normalized.slice(1);
  if (!normalized.startsWith('+84')) return [international];
  const national = normalized.slice(3);
  return [`0${national}`, international, national];
};

/** Che SĐT khi chưa được phép xem đầy đủ: "+84912345678" -> "0912 345 •••". */
export const maskPhoneDisplay = (phone: string): string => {
  const display = formatPhoneDisplay(phone);
  return display.length > 3 ? `${display.slice(0, -3)}•••` : display;
};
