import { escapeRegex } from '../../../../common/utils/regex.util';
import { normalizeVietnamese } from '../../common/utils/vietnamese-text.util';
import { phoneSearchVariants } from '../../common/utils/phone-normalizer.util';

/** Từ khóa toàn số ngắn hơn ngưỡng này không trả kết quả nào (chống dò số, tài liệu 04 mục 3.2.3). */
export const PHONE_SEARCH_MIN_DIGITS = 4;
/** Từ khóa số từ ngưỡng này trở lên mới khớp chuỗi con; ngắn hơn chỉ khớp ĐUÔI số. */
export const PHONE_SEARCH_SUBSTRING_MIN_DIGITS = 6;

/**
 * Dựng `searchText` (không trả ra API). Ba phần ngăn cách bằng xuống dòng để một từ khóa không bao giờ khớp
 * vắt ngang hai phần (VD "a 0912" không khớp cuối tên + đầu số điện thoại):
 * `tên bỏ dấu \n email \n các dạng số`.
 */
export const buildSearchText = (input: {
  fullName: string;
  email: string | null;
  phone: string;
}): string =>
  [
    normalizeVietnamese(input.fullName),
    (input.email ?? '').trim().toLowerCase(),
    phoneSearchVariants(input.phone).join(' '),
  ].join('\n');

export type ParsedKeyword =
  | { kind: 'phone'; digits: string }
  | { kind: 'email'; text: string }
  | { kind: 'name'; text: string };

/** Phân loại từ khóa tìm kiếm: toàn chữ số (SĐT), có `@` (email), còn lại (tên, bỏ dấu). */
export const parseKeyword = (raw: string): ParsedKeyword => {
  const compact = raw.replace(/[\s.\-()]/g, '').replace(/^\+/, '');
  if (/^\d+$/.test(compact)) return { kind: 'phone', digits: compact };
  if (raw.includes('@'))
    return { kind: 'email', text: raw.trim().toLowerCase() };
  return { kind: 'name', text: normalizeVietnamese(raw) };
};

/** Điều kiện không khớp bản ghi nào. */
const MATCH_NOTHING = { _id: { $in: [] as never[] } };

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
