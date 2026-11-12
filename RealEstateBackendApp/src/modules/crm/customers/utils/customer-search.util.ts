import { escapeRegex } from '../../../../common/utils/regex.util';
import { normalizeVietnamese } from '../../common/utils/vietnamese-text.util';
import { phoneSearchVariants } from '../../common/utils/phone-normalizer.util';
import {
  CUSTOMER_CODE_PREFIX,
  CUSTOMER_CODE_WIDTH,
} from '../customer-code.constants';

/** Từ khóa toàn số ngắn hơn ngưỡng này không trả kết quả nào (chống dò số, tài liệu 04 mục 3.2.3). */
export const PHONE_SEARCH_MIN_DIGITS = 4;
/** Từ khóa số từ ngưỡng này trở lên mới khớp chuỗi con; ngắn hơn chỉ khớp ĐUÔI số. */
export const PHONE_SEARCH_SUBSTRING_MIN_DIGITS = 6;

/**
 * Dựng `searchText` (không trả ra API). Ba phần ngăn cách bằng xuống dòng để một từ khóa không bao giờ khớp
 * vắt ngang hai phần (VD "a 0912" không khớp cuối tên + đầu số điện thoại):
 * `tên bỏ dấu \n email \n các dạng số`. Khách không có SĐT (FR-01, `phone = null`) vẫn đủ ba phần, phần số rỗng.
 */
export const buildSearchText = (input: {
  fullName: string;
  email: string | null;
  phone: string | null;
}): string =>
  [
    normalizeVietnamese(input.fullName),
    (input.email ?? '').trim().toLowerCase(),
    input.phone ? phoneSearchVariants(input.phone).join(' ') : '',
  ].join('\n');

export type ParsedKeyword =
  | { kind: 'code'; digits: string }
  | { kind: 'phone'; digits: string }
  | { kind: 'email'; text: string }
  | { kind: 'name'; text: string };

/** Mã khách gõ vào ô tìm: tiền tố `KH` (hoa/thường), dấu gạch tùy chọn, rồi ít nhất một chữ số (FR-09). */
const CODE_KEYWORD = /^kh-?(\d+)$/i;

/**
 * Phân loại từ khóa tìm kiếm, theo thứ tự ưu tiên:
 * 1. mã khách (`kh-12`, `KH000123`, `kh 12`): PHẢI đứng trước nhánh số vì phải có tiền tố `KH` mới là tìm mã;
 * 2. toàn chữ số: SĐT (giữ nguyên quy tắc chặn dò số, số trần KHÔNG bao giờ là mã);
 * 3. có `@`: email; 4. còn lại: tên (bỏ dấu). `kh`, `kh-`, `khanh` không đủ chữ số nên rơi về tên.
 */
export const parseKeyword = (raw: string): ParsedKeyword => {
  const code = CODE_KEYWORD.exec(raw.replace(/\s+/g, ''));
  if (code) return { kind: 'code', digits: code[1] };
  const compact = raw.replace(/[\s.\-()]/g, '').replace(/^\+/, '');
  if (/^\d+$/.test(compact)) return { kind: 'phone', digits: compact };
  if (raw.includes('@'))
    return { kind: 'email', text: raw.trim().toLowerCase() };
  return { kind: 'name', text: normalizeVietnamese(raw) };
};

/** Điều kiện không khớp bản ghi nào. */
const MATCH_NOTHING = { _id: { $in: [] as never[] } };

/**
 * Điều kiện tìm theo mã khách: bằng mã đệm đủ 6 số (`kh-12` -> `KH-000012`) HOẶC bắt đầu bằng đúng phần đã gõ
 * (`kh-12` -> `KH-12…`, để gõ dở vẫn gợi ra). Cả hai nhánh có `$type: 'string'` để planner dùng được index partial
 * `customerCode_1` (partial chỉ dùng khi truy vấn hàm ý được bộ lọc `$type: 'string'`), regex neo đầu nên quét theo khoảng index.
 * Mã không nhạy cảm nên không áp ngưỡng số chữ số như SĐT.
 */
const buildCodeCondition = (digits: string): Record<string, unknown> => {
  const padded = `${CUSTOMER_CODE_PREFIX}${digits
    .replace(/^0+/, '')
    .padStart(CUSTOMER_CODE_WIDTH, '0')}`;
  return {
    $or: [
      { customerCode: { $type: 'string', $eq: padded } },
      {
        customerCode: {
          $type: 'string',
          $regex: `^${escapeRegex(CUSTOMER_CODE_PREFIX)}${escapeRegex(digits)}`,
        },
      },
    ],
  };
};

/**
 * Điều kiện Mongo cho từ khóa. Quy tắc chống dò SĐT qua tìm kiếm:
 * - toàn số < 4 chữ số: không khớp gì;
 * - 4-5 chữ số: chỉ khớp ĐUÔI của một dạng số (4-5 số cuối);
 * - từ 6 chữ số: khớp chuỗi con.
 * Regex luôn qua `escapeRegex` (chống ReDoS/regex injection).
 */
export const buildKeywordCondition = (
  keyword: ParsedKeyword,
): Record<string, unknown> => {
  if (keyword.kind === 'code') return buildCodeCondition(keyword.digits);
  if (keyword.kind === 'phone') {
    if (keyword.digits.length < PHONE_SEARCH_MIN_DIGITS) return MATCH_NOTHING;
    const pattern =
      keyword.digits.length >= PHONE_SEARCH_SUBSTRING_MIN_DIGITS
        ? escapeRegex(keyword.digits)
        : `${escapeRegex(keyword.digits)}(?: |$)`;
    return { searchText: { $regex: pattern } };
  }
  if (keyword.text.length === 0) return MATCH_NOTHING;
  return { searchText: { $regex: escapeRegex(keyword.text) } };
};
