/**
 * Hàm thuần của màn "Trường chân dung" (FR-41, chỉ Quản trị): gom theo nhóm, bản nháp sửa nhãn/lựa chọn -> body PATCH,
 * đổi thứ tự, đổi mã lỗi thành lời tiếng Việt. Không phụ thuộc React -> test trực tiếp. Backend vẫn kiểm lại mọi thứ.
 *
 * Quy tắc "đổi cấu hình không mất dữ liệu cũ" (khớp BE `mergeOptions`): lựa chọn KHÔNG gửi lên bị tắt chứ không xóa, nên
 * lựa chọn đã dùng không bao giờ biến mất khỏi dữ liệu khách; đổi nhãn giữ nguyên mã `value`.
 */
import type { ApiError } from '@crm/api';
import type { PersonaFieldOrderItem, PersonaFieldPatchBody } from '@crm/api/http/adminApi';
import { PERSONA_GROUP_LABELS } from '@crm/data/personaFields';
import { normalizeVietnamese, toSlug } from '@crm/lib/text';
import type { AdminPersonaField, PersonaFieldType, PersonaGroupCode } from '@crm/types/crm';

/** Giới hạn của backend (`persona.constants.ts`): nhãn 100 ký tự; mỗi lần gửi tối đa 50 lựa chọn; tổng kể cả đã tắt tối đa 100. */
export const PERSONA_LABEL_MAX_LENGTH = 100;
export const PERSONA_ACTIVE_OPTIONS_MAX = 50;
export const PERSONA_TOTAL_OPTIONS_MAX = 100;
/** Mã lựa chọn tự sinh từ nhãn dài tối đa 40 ký tự (BE cho 100, slug lọc tối đa 60). */
const OPTION_VALUE_MAX_LENGTH = 40;

export const PERSONA_FIELD_TYPE_LABELS: Record<PersonaFieldType, string> = {
  TEXT: 'Văn bản ngắn',
  TEXTAREA: 'Văn bản dài',
  NUMBER_RANGE: 'Khoảng số tiền',
  DATE: 'Ngày',
  SELECT: 'Chọn một',
  MULTI_SELECT: 'Chọn nhiều',
  BOOLEAN: 'Có/Không',
};

/** Chỉ SELECT/MULTI_SELECT có danh sách lựa chọn. */
export const hasPersonaOptions = (type: PersonaFieldType): boolean => type === 'SELECT' || type === 'MULTI_SELECT';

// --- Gom nhóm ------------------------------------------------------------------------------------------------------------

export interface PersonaFieldGroup {
  code: string;
  label: string;
  fields: AdminPersonaField[];
}

const KNOWN_GROUP_CODES = Object.keys(PERSONA_GROUP_LABELS) as PersonaGroupCode[];

/**
 * Gom trường theo 7 nhóm (đúng thứ tự `PERSONA_GROUP_LABELS`), trong nhóm theo `order` (bằng nhau giữ thứ tự máy chủ trả về), bỏ nhóm rỗng.
 * Trường thuộc nhóm lạ (Quản trị thêm nhóm mới) xếp thêm nhóm riêng ở cuối thay vì biến mất khỏi màn quản trị.
 */
export const groupPersonaFields = (fields: readonly AdminPersonaField[]): PersonaFieldGroup[] => {
  const known = new Set<string>(KNOWN_GROUP_CODES);
  const unknownCodes = [...new Set(fields.filter((field) => !known.has(field.groupCode)).map((field) => field.groupCode))];
  const groups: PersonaFieldGroup[] = [
    ...KNOWN_GROUP_CODES.map((code) => ({ code: code as string, label: PERSONA_GROUP_LABELS[code] })),
    ...unknownCodes.map((code) => ({ code, label: `Nhóm ${code}` })),
  ].map((group) => ({ ...group, fields: [] as AdminPersonaField[] }));
  const byCode = new Map(groups.map((group) => [group.code, group]));
  fields.forEach((field) => byCode.get(field.groupCode)?.fields.push(field));
  groups.forEach((group) => group.fields.sort((left, right) => left.order - right.order));
  return groups.filter((group) => group.fields.length > 0);
};

/** "5 lựa chọn" / "5 lựa chọn, 2 đã tắt"; kiểu không có lựa chọn -> chuỗi rỗng. */
export const summarizeOptions = (field: Pick<AdminPersonaField, 'type' | 'options'>): string => {
  if (!hasPersonaOptions(field.type)) return '';
  const disabledCount = field.options.filter((option) => !option.isActive).length;
  const activeCount = field.options.length - disabledCount;
  return disabledCount > 0 ? `${activeCount} lựa chọn, ${disabledCount} đã tắt` : `${activeCount} lựa chọn`;
};

// --- Đổi thứ tự ----------------------------------------------------------------------------------------------------------

export type MoveDirection = 'up' | 'down';

/**
 * Body `PUT /crm/persona-fields/order` khi chuyển trường lên/xuống 1 vị trí TRONG NHÓM của nó; `null` nếu đã ở đầu/cuối nhóm.
 * `order` là số dùng chung mọi nhóm nên chỉ hoán đổi các "ô" thứ tự mà nhóm đó đang giữ; ô trùng nhau (dữ liệu cũ) được đánh số lại
 * liên tiếp để việc đổi chỗ có hiệu lực. Chỉ gửi trường thật sự đổi `order`.
 */
export const buildMoveOrderItems = (fields: readonly AdminPersonaField[], fieldId: string, direction: MoveDirection): PersonaFieldOrderItem[] | null => {
  const target = fields.find((field) => field.id === fieldId);
  if (!target) return null;
  const group = fields.filter((field) => field.groupCode === target.groupCode).sort((left, right) => left.order - right.order);
  const index = group.findIndex((field) => field.id === fieldId);
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= group.length) return null;

  const sequence = [...group];
  [sequence[index], sequence[nextIndex]] = [sequence[nextIndex], sequence[index]];
  const sortedSlots = group.map((field) => field.order);
  const hasTie = new Set(sortedSlots).size !== sortedSlots.length;
  const slots = hasTie ? sortedSlots.map((_, position) => sortedSlots[0] + position) : sortedSlots;
  const items = sequence
    .map((field, position) => ({ field, order: slots[position] }))
    .filter(({ field, order }) => field.order !== order)
    .map(({ field, order }) => ({ id: field.id, order }));
  return items.length > 0 ? items : null;
};

// --- Bản nháp sửa trường -------------------------------------------------------------------------------------------------

export interface OptionDraft {
  /** Mã lưu vào dữ liệu khách; lựa chọn có sẵn giữ nguyên, lựa chọn mới tự sinh từ nhãn. */
  value: string;
  label: string;
  isActive: boolean;
  /** Mới thêm trong form (chưa lưu): được bỏ đi hẳn; lựa chọn đã có chỉ tắt được. */
  isNew: boolean;
}

export interface PersonaFieldDraft {
  fieldId: string;
  label: string;
  options: OptionDraft[];
}

export const toPersonaFieldDraft = (field: AdminPersonaField): PersonaFieldDraft => ({
  fieldId: field.id,
  label: field.label,
  options: field.options.map((option) => ({ value: option.value, label: option.label, isActive: option.isActive, isNew: false })),
});

/**
 * Mã cho lựa chọn mới từ nhãn ("Biệt thự / Villa" -> "BIET_THU_VILLA"), không trùng mã đã có (kể cả lựa chọn đã tắt, so theo
 * slug như máy chủ) bằng cách thêm hậu tố `_2`, `_3`...
 */
export const makeOptionValue = (label: string, takenValues: readonly string[]): string => {
  const taken = new Set(takenValues.map((value) => toSlug(value)));
  const base = toSlug(label).toUpperCase().slice(0, OPTION_VALUE_MAX_LENGTH).replace(/_+$/, '') || 'OPTION';
  let candidate = base;
  for (let suffix = 2; taken.has(toSlug(candidate)); suffix += 1) {
    const tail = `_${suffix}`;
    candidate = `${base.slice(0, OPTION_VALUE_MAX_LENGTH - tail.length)}${tail}`;
  }
  return candidate;
};

const sameLabel = (left: string, right: string): boolean => normalizeVietnamese(left) === normalizeVietnamese(right);

/**
 * Thêm lựa chọn theo nhãn người dùng gõ. Nhãn trùng một lựa chọn ĐANG DÙNG -> lỗi; trùng lựa chọn ĐÃ TẮT -> bật lại lựa chọn đó
 * (giữ mã cũ nên dữ liệu khách cũ khớp lại, không sinh hai lựa chọn cùng nhãn gây nhầm khi đổi nhãn <-> mã).
 */
export const addOptionToDraft = (draft: PersonaFieldDraft, rawLabel: string): { draft: PersonaFieldDraft; error: string | null } => {
  const label = rawLabel.trim();
  if (!label) return { draft, error: 'Nhập tên lựa chọn.' };
  if (label.length > PERSONA_LABEL_MAX_LENGTH) return { draft, error: `Lựa chọn tối đa ${PERSONA_LABEL_MAX_LENGTH} ký tự.` };
  const existing = draft.options.find((option) => sameLabel(option.label, label));
  if (existing?.isActive) return { draft, error: `Đã có lựa chọn "${existing.label}".` };
  if (existing) {
    return { draft: { ...draft, options: draft.options.map((option) => (option === existing ? { ...option, isActive: true } : option)) }, error: null };
  }
  if (draft.options.length >= PERSONA_TOTAL_OPTIONS_MAX) return { draft, error: `Một trường tối đa ${PERSONA_TOTAL_OPTIONS_MAX} lựa chọn (kể cả đã tắt).` };
  const value = makeOptionValue(label, draft.options.map((option) => option.value));
  return { draft: { ...draft, options: [...draft.options, { value, label, isActive: true, isNew: true }] }, error: null };
};

/** Lỗi nháp (hoặc `null`): nhãn trường, và với SELECT/MULTI_SELECT: ít nhất 1 lựa chọn dùng, không trùng nhãn, đủ giới hạn. */
export const validatePersonaFieldDraft = (draft: PersonaFieldDraft, type: PersonaFieldType): string | null => {
  const label = draft.label.trim();
  if (!label) return 'Nhãn trường không được để trống.';
  if (label.length > PERSONA_LABEL_MAX_LENGTH) return `Nhãn trường tối đa ${PERSONA_LABEL_MAX_LENGTH} ký tự.`;
  if (!hasPersonaOptions(type)) return null;

  const active = draft.options.filter((option) => option.isActive);
  if (active.length === 0) return 'Cần ít nhất một lựa chọn đang dùng.';
  if (active.length > PERSONA_ACTIVE_OPTIONS_MAX) return `Tối đa ${PERSONA_ACTIVE_OPTIONS_MAX} lựa chọn đang dùng.`;
  if (draft.options.length > PERSONA_TOTAL_OPTIONS_MAX) return `Một trường tối đa ${PERSONA_TOTAL_OPTIONS_MAX} lựa chọn (kể cả đã tắt).`;
  const seen = new Set<string>();
  for (const option of draft.options) {
    const optionLabel = option.label.trim();
    if (option.isActive && !optionLabel) return 'Tên lựa chọn không được để trống.';
    if (optionLabel.length > PERSONA_LABEL_MAX_LENGTH) return `Lựa chọn tối đa ${PERSONA_LABEL_MAX_LENGTH} ký tự.`;
    const key = normalizeVietnamese(optionLabel);
    if (seen.has(key)) return `Lựa chọn trùng nhau: "${optionLabel}".`;
    seen.add(key);
  }
  return null;
};

/**
 * Body `PATCH /crm/persona-fields/:id` chỉ gồm phần thật sự đổi (rỗng = không đổi gì -> không gọi API).
 * `options` gửi các lựa chọn ĐANG DÙNG theo thứ tự nháp; lựa chọn tắt bị bỏ khỏi danh sách nên backend giữ lại ở trạng thái tắt
 * (không xóa, mã vẫn đọc được giá trị cũ của khách), đồng thời không vượt trần 50 lựa chọn mỗi lần gửi dù tổng đã tắt lên tới 100.
 */
export const buildPersonaFieldPatch = (field: AdminPersonaField, draft: PersonaFieldDraft): PersonaFieldPatchBody => {
  const patch: PersonaFieldPatchBody = {};
  const label = draft.label.trim();
  if (label !== field.label) patch.label = label;
  if (hasPersonaOptions(field.type)) {
    const before = new Map(field.options.filter((option) => option.isActive).map((option) => [option.value, option.label]));
    const after = draft.options.filter((option) => option.isActive).map((option) => ({ value: option.value, label: option.label.trim(), isActive: true }));
    const isChanged = after.length !== before.size || after.some((option) => before.get(option.value) !== option.label);
    if (isChanged) patch.options = after;
  }
  return patch;
};

// --- Lỗi -----------------------------------------------------------------------------------------------------------------

const valueCountOf = (error: ApiError): number | null => {
  const count = error.details?.valueCount;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
};

/**
 * Lời tiếng Việt cho lỗi ghi trường chân dung, dựa vào `errorCode` + `details` (không dựa nội dung `message` của máy chủ):
 * - `PERSONA_FIELD_SYSTEM` `{ field: 'type' }`: đổi kiểu trường hệ thống; `{ valueCount }`: xóa trường hệ thống.
 * - `PERSONA_FIELD_TYPE_LOCKED` `{ valueCount }`: đổi kiểu khi đã có dữ liệu khách.
 * - `VALIDATION_FAILED` (400: tắt hết lựa chọn, trùng mã, quá trần...) và lỗi khác: lời của máy chủ (đã là tiếng Việt).
 */
export const describePersonaFieldError = (error: ApiError): string => {
  if (error.errorCode === 'PERSONA_FIELD_SYSTEM') {
    if (error.details?.field === 'type') return 'Trường hệ thống không đổi kiểu được. Hãy sửa nhãn/lựa chọn, tắt trường hoặc tạo trường mới.';
    const count = valueCountOf(error);
    return `Trường hệ thống không xóa được${count === null ? '' : ` (${count} khách đang có dữ liệu)`}. Hãy tắt trường nếu không dùng.`;
  }
  if (error.errorCode === 'PERSONA_FIELD_TYPE_LOCKED') {
    const count = valueCountOf(error);
    return `Trường đã có dữ liệu${count === null ? '' : ` của ${count} khách`} nên không đổi kiểu được. Hãy tạo trường mới.`;
  }
  if (error.statusCode === 404) return 'Trường này không còn tồn tại. Danh sách đã được tải lại.';
  return error.message;
};
