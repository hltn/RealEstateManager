import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Bảng đổi đầu số 11 số cũ (0162...) sang 10 số mới (032...) theo quy hoạch của Bộ TT&TT (2018).
 * Khóa là 3 số sau số 0 đầu (`162`), giá trị là đầu số mới không có số 0 (`32`).
 */
const OLD_PREFIX_MAP: Readonly<Record<string, string>> = {
  '162': '32',
  '163': '33',
  '164': '34',
  '165': '35',
  '166': '36',
  '167': '37',
  '168': '38',
  '169': '39',
  '120': '70',
  '121': '79',
  '122': '77',
  '126': '76',
  '128': '78',
  '123': '83',
  '124': '84',
  '125': '85',
  '127': '81',
  '129': '82',
  '186': '56',
  '188': '58',
  '199': '59',
};

const MAX_INPUT_LENGTH = 30;
/** `0162xxxxxxx` / `84162xxxxxxx` / `+84162xxxxxxx`: đầu số cũ + 7 số thuê bao. */
const OLD_FORMAT_PATTERN = /^(?:\+?84|0)(1\d{2})(\d{7})$/;

/**
 * Chuẩn hóa số điện thoại về E.164 (tài liệu 04 mục 3.2.1):
 * 1. bỏ khoảng trắng, `.`, `-`, `()`; `00` đầu đổi thành `+`;
 * 2. đổi đầu số 11 số cũ sang 10 số (VN);
 * 3. parse bằng libphonenumber-js với vùng mặc định `VN` (số nước ngoài phải có `+`).
 *
 * Trả `null` khi không hợp lệ (caller ném 400 `INVALID_PHONE`).
 */
export const normalizePhone = (input: string): string | null => {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) return null;
  let compact = input.replace(/[\s.\-()]/g, '');
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  if (!/^\+?\d{6,20}$/.test(compact)) return null;

  const oldFormat = OLD_FORMAT_PATTERN.exec(compact);
  if (oldFormat) {
    const newPrefix = OLD_PREFIX_MAP[oldFormat[1]];
    if (newPrefix) compact = `0${newPrefix}${oldFormat[2]}`;
  }

  const parsed = parsePhoneNumberFromString(compact, 'VN');
  return parsed?.isValid() ? parsed.number : null;
};

const VN_PREFIX = '+84';

/**
 * Các dạng số dùng để tìm kiếm (ghi vào `searchText`): VN có `0912345678` và `84912345678`;
 * số nước ngoài chỉ có dạng toàn chữ số của E.164.
 */
export const phoneSearchVariants = (e164: string): string[] => {
  if (e164.startsWith(VN_PREFIX)) {
    const national = e164.slice(VN_PREFIX.length);
    return [`0${national}`, `84${national}`];
  }
  return [e164.replace(/^\+/, '')];
};

/**
 * Che số điện thoại để hiển thị trong danh sách/chi tiết (VD `0912 ••• 678`): số VN hiển thị dạng quốc gia
 * (đầu `0`), số nước ngoài giữ dạng E.164; chỉ lộ 4 ký tự đầu và 3 số cuối.
 */
export const maskPhone = (e164: string): string => {
  const display = e164.startsWith(VN_PREFIX)
    ? `0${e164.slice(VN_PREFIX.length)}`
    : e164;
  if (display.length < 8) return `••• ${display.slice(-2)}`;
  return `${display.slice(0, 4)} ••• ${display.slice(-3)}`;
};
