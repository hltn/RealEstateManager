import { Types } from 'mongoose';
import { escapeRegex } from '../../../common/utils/regex.util';
import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';
import {
  FILTER_SLUG_MAX_LENGTH,
  FILTERABLE_FIELD_TYPES,
  MAX_MISSING_SUGGESTIONS,
  PERSONA_MAX_TOTAL_OPTIONS,
  OPTION_FIELD_TYPES,
  PERSONA_MAX_MULTI_VALUES,
  PERSONA_NUMBER_MAX,
  PERSONA_TEXT_MAX_LENGTH,
  PERSONA_TEXTAREA_MAX_LENGTH,
  PersonaFieldType,
  PersonaSource,
} from './persona.constants';

/** Một lựa chọn của trường SELECT/MULTI_SELECT. Bỏ lựa chọn = `isActive: false` (không xóa, dữ liệu cũ vẫn đọc được). */
export interface PersonaOptionDef {
  value: string;
  label: string;
  isActive: boolean;
}

/** Phần cấu hình trường mà logic thuần cần (không phụ thuộc Mongoose). */
export interface PersonaFieldDef {
  key: string;
  label: string;
  groupCode: string;
  type: PersonaFieldType;
  options?: PersonaOptionDef[];
  order: number;
  weight: number;
  suggestPriority: number;
  isFilterable: boolean;
  isOccasion: boolean;
  isSensitive: boolean;
  isActive: boolean;
}

/** Giá trị của một trường: chỉ các khóa hợp với kiểu của trường mới được có mặt. */
export interface PersonaValueParts {
  valueText?: string;
  valueNumber?: number;
  valueNumberTo?: number;
  valueDate?: string;
  valueOptions?: string[];
  valueBoolean?: boolean;
}

/** Giá trị đã lưu trong `customers.persona` (kèm người/ngày/nguồn, QT9). */
export interface StoredPersonaValue extends PersonaValueParts {
  fieldKey: string;
  source: PersonaSource;
  updatedBy: Types.ObjectId;
  updatedAt: Date;
}

export interface PersonaOccasion {
  fieldKey: string;
  month: number;
  day: number;
  year: number;
}

/** Các thuộc tính suy ra từ chân dung + cấu hình trường; ghi cùng lệnh update (tài liệu 04 mục 3.2.2). */
export interface PersonaDerived {
  personaCompleteness: number;
  personaFilterKeys: string[];
  occasions: PersonaOccasion[];
}

const VALUE_KEYS = [
  'valueText',
  'valueNumber',
  'valueNumberTo',
  'valueDate',
  'valueOptions',
  'valueBoolean',
] as const satisfies ReadonlyArray<keyof PersonaValueParts>;

const ALLOWED_VALUE_KEYS: Record<
  PersonaFieldType,
  ReadonlyArray<keyof PersonaValueParts>
> = {
  [PersonaFieldType.TEXT]: ['valueText'],
  [PersonaFieldType.TEXTAREA]: ['valueText'],
  [PersonaFieldType.NUMBER]: ['valueNumber'],
  [PersonaFieldType.NUMBER_RANGE]: ['valueNumber', 'valueNumberTo'],
  [PersonaFieldType.DATE]: ['valueDate'],
  [PersonaFieldType.SELECT]: ['valueOptions'],
  [PersonaFieldType.MULTI_SELECT]: ['valueOptions'],
  [PersonaFieldType.BOOLEAN]: ['valueBoolean'],
};

export type ParsePersonaResult =
  | { ok: true; value: PersonaValueParts }
  | { ok: false; message: string };

const fail = (message: string): ParsePersonaResult => ({ ok: false, message });

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** `YYYY-MM-DD` là ngày lịch có thật trong khoảng 1900-2100. */
export const parseIsoDate = (
  text: string,
): { year: number; month: number; day: number } | null => {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? { year, month, day } : null;
};

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= PERSONA_NUMBER_MAX;

/**
 * Kiểm và chuẩn hóa giá trị theo KIỂU trường. Chỉ nhận đúng các khóa hợp với kiểu (gửi `valueText` cho trường số
 * là sai); chuỗi được cắt khoảng trắng; SELECT/MULTI_SELECT chỉ nhận lựa chọn đang hoạt động HOẶC lựa chọn khách đã
 * có sẵn (`keepOptions`): lựa chọn bị tắt không bị coi là lỗi khi lưu lại đúng giá trị cũ.
 */
export const parsePersonaValue = (
  field: Pick<PersonaFieldDef, 'type' | 'options'>,
  input: PersonaValueParts,
  keepOptions: readonly string[] = [],
): ParsePersonaResult => {
  const allowedKeys = ALLOWED_VALUE_KEYS[field.type];
  const unexpected = VALUE_KEYS.filter(
    (key) => input[key] !== undefined && !allowedKeys.includes(key),
  );
  if (unexpected.length > 0) {
    return fail(`Kiểu ${field.type} không nhận ${unexpected.join(', ')}`);
  }

  switch (field.type) {
    case PersonaFieldType.TEXT:
    case PersonaFieldType.TEXTAREA: {
      const max =
        field.type === PersonaFieldType.TEXT
          ? PERSONA_TEXT_MAX_LENGTH
          : PERSONA_TEXTAREA_MAX_LENGTH;
      const text =
        typeof input.valueText === 'string' ? input.valueText.trim() : '';
      if (!text) return fail('Cần nhập nội dung (dùng null để xóa giá trị)');
      if (text.length > max) return fail(`Tối đa ${max} ký tự`);
      return { ok: true, value: { valueText: text } };
    }
    case PersonaFieldType.NUMBER:
      if (!isValidNumber(input.valueNumber)) {
        return fail('Cần một số từ 0 đến 10^13');
      }
      return { ok: true, value: { valueNumber: input.valueNumber } };
    case PersonaFieldType.NUMBER_RANGE: {
      const { valueNumber: from, valueNumberTo: to } = input;
      if (from === undefined && to === undefined) {
        return fail('Cần ít nhất một đầu của khoảng');
      }
      if (
        (from !== undefined && !isValidNumber(from)) ||
        (to !== undefined && !isValidNumber(to))
      ) {
        return fail('Giá trị khoảng phải là số từ 0 đến 10^13');
      }
      if (from !== undefined && to !== undefined && from > to) {
        return fail('Đầu dưới của khoảng không được lớn hơn đầu trên');
      }
      return {
        ok: true,
        value: {
          ...(from !== undefined && { valueNumber: from }),
          ...(to !== undefined && { valueNumberTo: to }),
        },
      };
    }
    case PersonaFieldType.DATE:
      if (
        typeof input.valueDate !== 'string' ||
        !parseIsoDate(input.valueDate)
      ) {
        return fail('Ngày phải theo định dạng YYYY-MM-DD hợp lệ');
      }
      return { ok: true, value: { valueDate: input.valueDate } };
    case PersonaFieldType.BOOLEAN:
      if (typeof input.valueBoolean !== 'boolean') {
        return fail('Cần giá trị true hoặc false');
      }
      return { ok: true, value: { valueBoolean: input.valueBoolean } };
    case PersonaFieldType.SELECT:
    case PersonaFieldType.MULTI_SELECT: {
      const picked = input.valueOptions;
      const isSingle = field.type === PersonaFieldType.SELECT;
      const max = isSingle ? 1 : PERSONA_MAX_MULTI_VALUES;
      if (
        !Array.isArray(picked) ||
        picked.length === 0 ||
        picked.length > max ||
        picked.some((item) => typeof item !== 'string') ||
        new Set(picked).size !== picked.length
      ) {
        return fail(
          isSingle
            ? 'Cần chọn đúng một lựa chọn'
            : `Cần chọn từ 1 đến ${max} lựa chọn, không trùng nhau`,
        );
      }
      const allowed = new Set([
        ...(field.options ?? [])
          .filter((option) => option.isActive)
          .map((option) => option.value),
        ...keepOptions,
      ]);
      const unknown = picked.filter((item) => !allowed.has(item));
      if (unknown.length > 0) {
        return fail(`Lựa chọn không hợp lệ: ${unknown.join(', ')}`);
      }
      return { ok: true, value: { valueOptions: [...picked] } };
    }
  }
};

/** Dạng chuẩn để so sánh hai giá trị (bỏ khóa trống, lựa chọn nhiều không phân biệt thứ tự). */
const canonicalValue = (value: PersonaValueParts): string =>
  JSON.stringify(
    VALUE_KEYS.map((key) =>
      key === 'valueOptions' && value.valueOptions
        ? [...value.valueOptions].sort()
        : (value[key] ?? null),
    ),
  );

export const isSamePersonaValue = (
  a: PersonaValueParts,
  b: PersonaValueParts,
): boolean => canonicalValue(a) === canonicalValue(b);

/** Chỉ giữ các khóa giá trị (bỏ `fieldKey`, `source`, `updatedBy`...) — dùng khi trả response/so sánh. */
export const pickValueParts = (
  stored: PersonaValueParts,
): PersonaValueParts => {
  const parts: PersonaValueParts = {};
  for (const key of VALUE_KEYS) {
    if (stored[key] !== undefined && stored[key] !== null) {
      (parts as Record<string, unknown>)[key] = stored[key];
    }
  }
  return parts;
};

/** Trường "đã có giá trị" để tính độ đầy đủ: `false` của BOOLEAN và số 0 VẪN là đã có giá trị. */
export const hasPersonaValue = (
  type: PersonaFieldType,
  value: PersonaValueParts | undefined,
): boolean => {
  if (!value) return false;
  switch (type) {
    case PersonaFieldType.TEXT:
    case PersonaFieldType.TEXTAREA:
      return !!value.valueText?.trim();
    case PersonaFieldType.NUMBER:
      return typeof value.valueNumber === 'number';
    case PersonaFieldType.NUMBER_RANGE:
      return (
        typeof value.valueNumber === 'number' ||
        typeof value.valueNumberTo === 'number'
      );
    case PersonaFieldType.DATE:
      return !!value.valueDate;
    case PersonaFieldType.SELECT:
    case PersonaFieldType.MULTI_SELECT:
      return (value.valueOptions?.length ?? 0) > 0;
    case PersonaFieldType.BOOLEAN:
      return typeof value.valueBoolean === 'boolean';
  }
};

/** Dạng gọn của giá trị để ghi vào audit/hiển thị lịch sử (NUMBER_RANGE: `{ from, to }`). */
export const summarizePersonaValue = (
  type: PersonaFieldType,
  value: PersonaValueParts,
): unknown => {
  switch (type) {
    case PersonaFieldType.NUMBER_RANGE:
      return {
        from: value.valueNumber ?? null,
        to: value.valueNumberTo ?? null,
      };
    case PersonaFieldType.NUMBER:
      return value.valueNumber ?? null;
    case PersonaFieldType.DATE:
      return value.valueDate ?? null;
    case PersonaFieldType.SELECT:
    case PersonaFieldType.MULTI_SELECT:
      return value.valueOptions ?? [];
    case PersonaFieldType.BOOLEAN:
      return value.valueBoolean ?? null;
    default:
      return value.valueText ?? null;
  }
};

/** Chuẩn hóa văn bản thành mảnh token lọc: không dấu, chữ thường, ký tự lạ thành `_`. */
export const toFilterSlug = (text: string): string =>
  normalizeVietnamese(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, FILTER_SLUG_MAX_LENGTH)
    .replace(/_+$/g, '');

export const buildFilterToken = (fieldKey: string, rawValue: string): string =>
  `${fieldKey}=${toFilterSlug(rawValue)}`;

const filterTokensOf = (
  field: PersonaFieldDef,
  value: PersonaValueParts,
): string[] => {
  switch (field.type) {
    case PersonaFieldType.TEXT:
      return value.valueText && toFilterSlug(value.valueText)
        ? [buildFilterToken(field.key, value.valueText)]
        : [];
    case PersonaFieldType.SELECT:
    case PersonaFieldType.MULTI_SELECT:
      return (value.valueOptions ?? [])
        .filter((option) => toFilterSlug(option))
        .map((option) => buildFilterToken(field.key, option));
    case PersonaFieldType.BOOLEAN:
      return typeof value.valueBoolean === 'boolean'
        ? [`${field.key}=${value.valueBoolean}`]
        : [];
    default:
      return [];
  }
};

/**
 * Suy ra từ chân dung + cấu hình HIỆN TẠI: độ đầy đủ, token lọc và dịp đặc biệt. Chỉ tính trường đang hoạt động —
 * trường bị tắt giữ nguyên giá trị trong `customers.persona` nhưng không góp vào các thuộc tính này, nên bật lại là
 * dữ liệu hiện lại (không mất gì).
 *
 * Độ đầy đủ = round(Σ weight trường có giá trị / Σ weight trường hoạt động × 100) (tài liệu 04 mục 3.2.2).
 */
export const derivePersona = (
  fields: readonly PersonaFieldDef[],
  persona: ReadonlyArray<
    Pick<StoredPersonaValue, 'fieldKey'> & PersonaValueParts
  >,
): PersonaDerived => {
  const valueByKey = new Map(persona.map((item) => [item.fieldKey, item]));
  let totalWeight = 0;
  let filledWeight = 0;
  const filterKeys = new Set<string>();
  const occasions: PersonaOccasion[] = [];

  for (const field of fields) {
    // Trường nhạy cảm không tính vào độ đầy đủ và không sinh token lọc/dịp (không "hỏi cho đủ", không dò ra được
    // qua bộ lọc), kể cả dữ liệu cũ còn cờ lọc.
    if (!field.isActive || field.isSensitive) continue;
    totalWeight += field.weight;
    const value = valueByKey.get(field.key);
    if (!hasPersonaValue(field.type, value)) continue;
    filledWeight += field.weight;
    if (field.isFilterable) {
      for (const token of filterTokensOf(field, value!)) filterKeys.add(token);
    }
    if (field.isOccasion && field.type === PersonaFieldType.DATE) {
      const date = parseIsoDate(value!.valueDate!);
      if (date) occasions.push({ fieldKey: field.key, ...date });
    }
  }

  return {
    personaCompleteness:
      totalWeight > 0 ? Math.round((filledWeight / totalWeight) * 100) : 0,
    personaFilterKeys: [...filterKeys],
    occasions,
  };
};

/** Gợi ý "nên hỏi tiếp": trường hoạt động chưa có giá trị, ưu tiên `suggestPriority` nhỏ trước, tối đa 5. */
export const pickMissingFields = (
  fields: readonly PersonaFieldDef[],
  persona: ReadonlyArray<
    Pick<StoredPersonaValue, 'fieldKey'> & PersonaValueParts
  >,
): PersonaFieldDef[] => {
  const valueByKey = new Map(persona.map((item) => [item.fieldKey, item]));
  return fields
    .filter(
      (field) =>
        field.isActive &&
        !field.isSensitive &&
        !hasPersonaValue(field.type, valueByKey.get(field.key)),
    )
    .sort((a, b) => a.suggestPriority - b.suggestPriority || a.order - b.order)
    .slice(0, MAX_MISSING_SUGGESTIONS);
};

/**
 * Gộp danh sách lựa chọn mong muốn vào danh sách hiện có. Lựa chọn hiện có mà vắng mặt trong danh sách mới KHÔNG bị
 * xóa mà chuyển `isActive: false` (khách đã chọn vẫn đọc được) — đây là cách "đổi cấu hình không mất dữ liệu".
 */
export const mergeOptions = (
  existing: readonly PersonaOptionDef[],
  desired: ReadonlyArray<{ value: string; label: string; isActive?: boolean }>,
): PersonaOptionDef[] => {
  const kept = desired.map((option) => ({
    value: option.value,
    label: option.label,
    isActive: option.isActive ?? true,
  }));
  const keptValues = new Set(kept.map((option) => option.value));
  const retired = existing
    .filter((option) => !keptValues.has(option.value))
    .map((option) => ({ ...option, isActive: false }));
  return [...kept, ...retired];
};

/** Giá trị lựa chọn trùng nhau (sau khi chuẩn hóa thành slug) hoặc slug rỗng => trả mô tả lỗi, hợp lệ => null. */
export const findOptionConflict = (
  options: ReadonlyArray<{ value: string }>,
): string | null => {
  const seen = new Set<string>();
  for (const option of options) {
    const slug = toFilterSlug(option.value);
    if (!slug) return `Giá trị lựa chọn "${option.value}" không hợp lệ`;
    if (seen.has(slug)) return `Lựa chọn trùng nhau: "${option.value}"`;
    seen.add(slug);
  }
  return null;
};

/** Ràng buộc kiểu trường khi tạo/sửa cấu hình; trả mô tả lỗi hoặc `null` nếu hợp lệ. */
export const findFieldShapeError = (
  field: Pick<
    PersonaFieldDef,
    'type' | 'options' | 'isFilterable' | 'isOccasion' | 'isSensitive'
  >,
): string | null => {
  const options = field.options ?? [];
  if (options.length > PERSONA_MAX_TOTAL_OPTIONS) {
    return `Một trường tối đa ${PERSONA_MAX_TOTAL_OPTIONS} lựa chọn (kể cả lựa chọn đã tắt)`;
  }
  if (OPTION_FIELD_TYPES.includes(field.type)) {
    if (!options.some((option) => option.isActive)) {
      return 'Trường chọn một/nhiều cần ít nhất một lựa chọn đang hoạt động';
    }
    const conflict = findOptionConflict(options);
    if (conflict) return conflict;
  } else if (options.length > 0) {
    return 'Chỉ trường SELECT/MULTI_SELECT mới có danh sách lựa chọn';
  }
  if (field.isOccasion && field.type !== PersonaFieldType.DATE) {
    return 'Chỉ trường kiểu DATE mới là dịp đặc biệt';
  }
  if (field.isFilterable && !FILTERABLE_FIELD_TYPES.includes(field.type)) {
    return 'Kiểu trường này không dùng làm bộ lọc';
  }
  if (field.isSensitive && field.isFilterable) {
    return 'Trường nhạy cảm không được dùng làm bộ lọc (giá trị sẽ lộ qua token lọc)';
  }
  return null;
};

const NO_MATCH = { _id: { $in: [] as Types.ObjectId[] } };

/** `fieldKey:value` => [fieldKey, value]; sai định dạng => null. */
export const parsePersonaFilter = (
  text: string,
): { key: string; value: string } | null => {
  const index = text.indexOf(':');
  if (index <= 0) return null;
  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim();
  return key && value ? { key, value } : null;
};

/**
 * Điều kiện Mongo cho bộ lọc theo chân dung của danh sách khách:
 * - `occupation`: khớp TIỀN TỐ token `occupation=...` (gõ "ke toan" ra cả "Kế toán trưởng");
 * - `personaFilters` (`fieldKey:value`): cùng `fieldKey` thì HOẶC, khác `fieldKey` thì VÀ; khớp đẳng thức token.
 * Giá trị chuẩn hóa như lúc ghi (bỏ dấu, chữ thường) nên người dùng gõ có dấu hay không đều khớp.
 */
export const buildPersonaFilterConditions = (query: {
  occupation?: string;
  personaFilters?: string[];
}): Record<string, unknown>[] => {
  const conditions: Record<string, unknown>[] = [];

  if (query.occupation) {
    const slug = toFilterSlug(query.occupation);
    conditions.push(
      slug
        ? {
            personaFilterKeys: {
              $regex: new RegExp(`^occupation=${escapeRegex(slug)}`),
            },
          }
        : NO_MATCH,
    );
  }

  const tokensByKey = new Map<string, Set<string>>();
  for (const raw of query.personaFilters ?? []) {
    const parsed = parsePersonaFilter(raw);
    const slug = parsed ? toFilterSlug(parsed.value) : '';
    if (!parsed || !slug) {
      conditions.push(NO_MATCH);
      continue;
    }
    const tokens = tokensByKey.get(parsed.key) ?? new Set<string>();
    // BOOLEAN lưu `key=true|false`; slug của "true"/"false" trùng nên dùng chung đường này.
    tokens.add(`${parsed.key}=${slug}`);
    tokensByKey.set(parsed.key, tokens);
  }
  for (const tokens of tokensByKey.values()) {
    conditions.push({ personaFilterKeys: { $in: [...tokens] } });
  }
  return conditions;
};
