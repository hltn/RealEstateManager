import { CrmAuditChange } from './crm-audit.constants';

/** Chuẩn hóa giá trị về dạng so sánh được (ObjectId/Date/mảng/object lồng nhau -> chuỗi JSON ổn định). */
const toComparable = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, nested: unknown) =>
    nested !== null && typeof nested === 'object' && 'toHexString' in nested
      ? (nested as { toHexString(): string }).toHexString()
      : nested,
  );

/** Giá trị đưa vào audit: ObjectId thành chuỗi hex để đọc được và không phụ thuộc kiểu BSON. */
const toAuditValue = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(toAuditValue);
  if (
    value !== null &&
    typeof value === 'object' &&
    'toHexString' in value &&
    typeof value.toHexString === 'function'
  ) {
    return (value as { toHexString(): string }).toHexString();
  }
  return value;
};

/**
 * So sánh `before` và `after` theo danh sách `fields`, trả về các field THỰC SỰ đổi
 * dưới dạng `[{ field, from, to }]` (rỗng nếu không đổi gì).
 */
export const diffFields = (
  before: object,
  after: object,
  fields: readonly string[],
): CrmAuditChange[] => {
  const beforeValues = before as Record<string, unknown>;
  const afterValues = after as Record<string, unknown>;
  return fields
    .filter(
      (field) =>
        toComparable(beforeValues[field]) !== toComparable(afterValues[field]),
    )
    .map((field) => ({
      field,
      from: toAuditValue(beforeValues[field]),
      to: toAuditValue(afterValues[field]),
    }));
};
