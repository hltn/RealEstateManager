/**
 * So khớp tên khu vực (34 tỉnh/thành) cho import CSV và ô tìm khu vực: bỏ tiền tố "TP."/"Thành phố"/"Tỉnh",
 * bỏ hậu tố ", Việt Nam", và nhận một số cách gọi quen thuộc (TP.HCM, Sài Gòn, HN...).
 * Hàm thuần, không đọc store -> test được.
 */
import { normalizeVietnamese } from './text';

/** Tiền tố hành chính đứng đầu tên: "tp. ho chi minh", "thanh pho ha noi", "tinh nghe an". */
const ADMIN_PREFIX_PATTERN = /^(?:thanh pho|tinh|tp)\b\.?\s*/;
/** Hậu tố quốc gia: "ha noi, viet nam", "ha noi - vietnam". */
const COUNTRY_SUFFIX_PATTERN = /[\s,-]*\b(?:viet nam|vietnam)$/;

/**
 * Cách gọi khác (đã chuẩn hoá bỏ dấu/tiền tố) -> khoá chuẩn của tên tỉnh trong danh mục.
 * Chỉ liệt kê cách gọi chắc chắn đúng với danh sách 34 tỉnh hiện hành (KHÔNG thêm tỉnh cũ đã sáp nhập).
 */
const AREA_ALIASES: Readonly<Record<string, string>> = {
  hcm: 'ho chi minh',
  tphcm: 'ho chi minh',
  hcmc: 'ho chi minh',
  'sai gon': 'ho chi minh',
  saigon: 'ho chi minh',
  'ho chi minh city': 'ho chi minh',
  hn: 'ha noi',
  hanoi: 'ha noi',
  haiphong: 'hai phong',
  danang: 'da nang',
  cantho: 'can tho',
  'dac lac': 'dak lak',
  'thua thien hue': 'hue',
};

/** "TP. Hồ Chí Minh" / "Thành phố Hồ Chí Minh, Việt Nam" -> "ho chi minh"; "HCM" / "Sài Gòn" -> "ho chi minh". */
export const toAreaKey = (value: string): string => {
  const base = normalizeVietnamese(value).replace(COUNTRY_SUFFIX_PATTERN, '').replace(ADMIN_PREFIX_PATTERN, '').trim();
  return AREA_ALIASES[base] ?? base;
};

/** Các chuỗi để tìm kiếm cho 1 tên khu vực: tên đầy đủ + khoá chuẩn + các cách gọi khác (đều đã bỏ dấu). */
export const getAreaSearchTerms = (label: string): string[] => {
  const key = toAreaKey(label);
  const aliases = Object.entries(AREA_ALIASES)
    .filter(([, target]) => target === key)
    .map(([alias]) => alias);
  return [normalizeVietnamese(label), key, ...aliases];
};
