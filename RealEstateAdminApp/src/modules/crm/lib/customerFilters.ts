/**
 * Tiện ích bộ lọc danh sách khách phía giao diện (đếm bộ lọc đang bật, tuỳ chọn tiến độ).
 * Logic so khớp nằm ở lớp dữ liệu (`api/queries.ts` — `matchesCustomerFilters`) để giống query backend.
 */
import type { CustomerFilters } from '@crm/types/app';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import { PROGRESS_VALUES } from './customerRules';

/** Trường "bộ lọc nâng cao" (ngoài ô tìm kiếm + tab danh sách). */
export type AdvancedFilterKey = Exclude<keyof CustomerFilters, 'q' | 'listGroup'>;

/** Trường chân dung của `personaFilters` (`fieldKey:value` -> `fieldKey`). */
const personaFilterKeyOf = (entry: string): string => entry.slice(0, Math.max(entry.indexOf(':'), 0));

/** Số trường chân dung đang lọc (nhiều giá trị của cùng một trường tính 1 nhóm). */
const countPersonaFilterFields = (personaFilters: readonly string[]): number => new Set(personaFilters.map(personaFilterKeyOf)).size;

/** Số nhóm bộ lọc nâng cao đang bật (hiện trên nút "Bộ lọc nâng cao"). Khoảng ngày cập nhật tính 1 nhóm. */
export const countActiveAdvancedFilters = (filters: CustomerFilters): number => {
  const arrayKeys: AdvancedFilterKey[] = ['statusIds', 'sourceIds', 'projectIds', 'areaIds', 'assigneeIds', 'primaryAssigneeIds', 'progress', 'tagIds'];
  const arrayCount = arrayKeys.filter((key) => (filters[key] as unknown[]).length > 0).length;
  const dateCount = filters.updatedFrom || filters.updatedTo ? 1 : 0;
  const occupationCount = filters.occupation.trim() ? 1 : 0;
  return arrayCount + dateCount + occupationCount + countPersonaFilterFields(filters.personaFilters);
};

/** Có từ khoá tìm kiếm hoặc bộ lọc nâng cao nào đang bật (tab danh sách không tính). */
export const hasActiveCustomerFilters = (filters: CustomerFilters): boolean => filters.q.trim() !== '' || countActiveAdvancedFilters(filters) > 0;

export const PROGRESS_FILTER_OPTIONS: readonly { value: number; label: string }[] = PROGRESS_VALUES.map((value) => ({
  value,
  label: `${value}% (${value / 25}/4)`,
}));

/** Bật/tắt 1 giá trị trong mảng bộ lọc. */
export const toggleValue = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

// ---------------------------------------------------------------------------
// Bộ lọc theo chân dung (FR-49): `personaFilters` = danh sách `fieldKey:value` (05 §2.3 — cùng trường HOẶC, khác trường VÀ).
// ---------------------------------------------------------------------------

/** Số `fieldKey:value` tối đa backend nhận (`PERSONA_FILTER_MAX_VALUES`); vượt là 400 làm hỏng cả danh sách. */
export const PERSONA_FILTER_MAX_VALUES = 20;

/** Khớp DTO backend: `fieldKey` là slug, `value` 1-100 ký tự; dấu phẩy bị loại vì mảng query nối bằng dấu phẩy (FR-32 `Hoãn`). */
const PERSONA_FILTER_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const PERSONA_FILTER_VALUE_MAX_LENGTH = 100;
/** `occupation` đã có ô nhập riêng (khớp tiền tố); kiểu TEXT khác không chọn được từ danh sách nên không đưa vào khối này. */
export const PERSONA_FILTER_TYPES: readonly PersonaFieldDefinition['type'][] = ['SELECT', 'MULTI_SELECT', 'BOOLEAN'];
const BOOLEAN_FILTER_OPTIONS: readonly PersonaFilterOption[] = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

export interface PersonaFilterOption {
  /** Mã lựa chọn lưu ở chân dung khách (backend chuẩn hóa slug hai phía khi so khớp). */
  value: string;
  label: string;
}

export interface PersonaFilterField {
  key: string;
  label: string;
  options: PersonaFilterOption[];
}

export const encodePersonaFilter = (fieldKey: string, value: string): string => `${fieldKey}:${value}`;

/** Giá trị đang chọn của một trường (bỏ tiền tố `fieldKey:`). */
export const getPersonaFilterValues = (personaFilters: readonly string[], fieldKey: string): string[] => {
  const prefix = `${fieldKey}:`;
  return personaFilters.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
};

const isSendablePersonaValue = (value: string): boolean => value.length > 0 && value.length <= PERSONA_FILTER_VALUE_MAX_LENGTH && !value.includes(',');

/** Lựa chọn lọc của một trường: mã lấy từ `optionItems` (API) hoặc nhãn khi không có (dữ liệu mẫu). */
const toFilterOptions = (field: PersonaFieldDefinition, selectedValues: readonly string[]): PersonaFilterOption[] => {
  if (field.type === 'BOOLEAN') return [...BOOLEAN_FILTER_OPTIONS];
  const items = field.optionItems ?? (field.options ?? []).map((label) => ({ value: label, label, isActive: true }));
  // Lựa chọn đã tắt chỉ giữ lại khi đang được chọn, để người dùng còn bỏ chọn được.
  return items.filter((item) => (item.isActive || selectedValues.includes(item.value)) && isSendablePersonaValue(item.value)).map(({ value, label }) => ({ value, label }));
};

/**
 * Trường chân dung hiện trong bộ lọc: đang hoạt động, `isFilterable`, không nhạy cảm, kiểu chọn được (SELECT/MULTI_SELECT/BOOLEAN),
 * `key` hợp lệ và còn ít nhất một lựa chọn. Trường không lọc được (hoặc vừa bị tắt lọc ở màn Trường chân dung) thì ẩn.
 */
export const buildPersonaFilterFields = (fields: readonly PersonaFieldDefinition[], selected: readonly string[]): PersonaFilterField[] =>
  fields
    .filter((field) => field.isActive && field.isFilterable && !field.isSensitive && PERSONA_FILTER_TYPES.includes(field.type) && PERSONA_FILTER_KEY_PATTERN.test(field.key))
    .map((field) => ({ key: field.key, label: field.label, options: toFilterOptions(field, getPersonaFilterValues(selected, field.key)) }))
    .filter((field) => field.options.length > 0);

/** Bật/tắt một giá trị của một trường; đã đủ `PERSONA_FILTER_MAX_VALUES` thì không thêm nữa (vẫn bỏ chọn được). */
export const togglePersonaFilter = (selected: readonly string[], fieldKey: string, value: string): string[] => {
  const entry = encodePersonaFilter(fieldKey, value);
  if (selected.includes(entry)) return selected.filter((item) => item !== entry);
  return selected.length >= PERSONA_FILTER_MAX_VALUES ? [...selected] : [...selected, entry];
};

/** Gỡ giá trị của trường không còn hiện trong khối lọc (bị tắt lọc/xóa), tránh bộ lọc "mồ côi" không có chỗ để bỏ. */
export const pruneOrphanPersonaFilters = (selected: readonly string[], visibleFields: readonly PersonaFilterField[]): string[] => {
  const visibleKeys = new Set(visibleFields.map((field) => field.key));
  return selected.filter((entry) => visibleKeys.has(personaFilterKeyOf(entry)));
};
