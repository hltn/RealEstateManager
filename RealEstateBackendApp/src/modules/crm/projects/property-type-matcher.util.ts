import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';

/** Lựa chọn của trường chân dung `property_type` (chỉ phần cần để khớp). */
export interface PropertyTypeOption {
  value: string;
  label: string;
  isActive?: boolean;
}

/** Kết quả ánh xạ chữ loại hình cũ: mã khớp (bỏ trùng, giữ thứ tự) và chữ không khớp (nguyên văn). */
export interface PropertyTypeMapping {
  codes: string[];
  unmapped: string[];
}

/**
 * Bảng từ đồng nghĩa cố định (Architecture 5.1.5): khóa là chữ đã `normalizeVietnamese`, giá trị là `value` của
 * lựa chọn. Chỉ có tác dụng khi lựa chọn đó tồn tại trong cấu hình `property_type`. Migration `008` dùng lại bảng này.
 */
export const PROPERTY_TYPE_SYNONYMS: Readonly<Record<string, string>> = {
  'can ho': 'APARTMENT',
  'nha pho': 'TOWNHOUSE',
  shophouse: 'TOWNHOUSE',
  'biet thu': 'VILLA',
  villa: 'VILLA',
  'dat nen': 'LAND',
  condotel: 'CONDOTEL',
  'nghi duong': 'CONDOTEL',
};

/** Các dạng chuẩn hóa của một lựa chọn dùng để so khớp: `value`, nhãn đầy đủ và từng phần nhãn tách bởi "/". */
const optionKeys = (option: PropertyTypeOption): string[] => [
  normalizeVietnamese(option.value),
  normalizeVietnamese(option.label),
  ...option.label.split('/').map((part) => normalizeVietnamese(part)),
];

/**
 * Ánh xạ danh sách chữ loại hình cũ sang `value` của lựa chọn `property_type` (FR-46).
 * Khớp sau chuẩn hóa (bỏ dấu, chữ thường, gom khoảng trắng) với `value`/nhãn, hoặc qua bảng từ đồng nghĩa.
 * Chữ không khớp được giữ nguyên văn trong `unmapped` (không mất dữ liệu). Chữ rỗng bị bỏ.
 */
export const mapPropertyTypeTexts = (
  texts: readonly string[],
  options: readonly PropertyTypeOption[],
): PropertyTypeMapping => {
  const valueByKey = new Map<string, string>();
  for (const option of options) {
    for (const key of optionKeys(option)) {
      if (key && !valueByKey.has(key)) valueByKey.set(key, option.value);
    }
  }
  const existingValues = new Set(options.map((option) => option.value));
  const codes: string[] = [];
  const unmapped: string[] = [];
  for (const text of texts) {
    const key = normalizeVietnamese(text);
    if (!key) continue;
    const synonym = PROPERTY_TYPE_SYNONYMS[key];
    const code =
      valueByKey.get(key) ??
      (synonym && existingValues.has(synonym) ? synonym : undefined);
    if (code === undefined) {
      if (!unmapped.includes(text)) unmapped.push(text);
    } else if (!codes.includes(code)) {
      codes.push(code);
    }
  }
  return { codes, unmapped };
};

/**
 * Nhãn hiển thị suy ra từ danh sách `value`: lựa chọn không còn trong cấu hình thì lấy nguyên văn `value`
 * (không lỗi). Giữ thứ tự, bỏ trùng.
 */
export const deriveLabels = (
  codes: readonly string[],
  options: readonly PropertyTypeOption[],
): string[] => {
  const labelByValue = new Map(
    options.map((option) => [option.value, option.label]),
  );
  return [...new Set(codes.map((code) => labelByValue.get(code) ?? code))];
};
