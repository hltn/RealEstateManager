/**
 * Mô hình form sửa hồ sơ + chân dung khách (C1, C10, C11, QT9) — hàm thuần, dùng chung desktop/mobile.
 * - Thông tin cơ bản: chỉ Họ tên + SĐT bắt buộc.
 * - Chân dung: form động theo cấu hình `PERSONA_FIELDS` (X10); bản nháp theo `fieldKey`, mọi trường không bắt buộc.
 * - Ngân sách nhập theo TỶ trên form, lưu VNĐ (04 §3.2.2).
 */
import type { CustomerDetail, PersonaValueInput, UpdateCustomerInput } from '@crm/api';
import { billionToVnd, findPersonaValue, isValidNationalId, vndToBillion } from '@crm/lib/customerRules';
import type { PersonaFieldDefinition, PersonaGroupCode, PersonaSource, PersonaValue } from '@crm/types/crm';
import { getFullNameError, getPhoneFormatError, isValidOptionalEmail, type FormErrors } from '../CreateCustomer/customerFormRules';

// ---------------------------------------------------------------------------
// Thông tin cơ bản
// ---------------------------------------------------------------------------

export interface BasicInfoValues {
  fullName: string;
  phone: string;
  email: string;
  /** Rỗng = giữ nguyên CCCD hiện có (chỉ nhập khi muốn thay). */
  nationalId: string;
  areaId: string;
  sourceId: string;
  interestedProjectIds: string[];
  tagIds: string[];
  notes: string;
}

export type BasicInfoField = keyof BasicInfoValues;

export const BASIC_FIELD_ORDER: readonly BasicInfoField[] = ['fullName', 'phone', 'email', 'nationalId'];

export const toBasicInfoValues = (customer: CustomerDetail): BasicInfoValues => ({
  fullName: customer.fullName,
  // Số đầy đủ KHÔNG nằm trong dữ liệu khách; chỉ lấy khi bấm "Sửa số" (qua createPhoneView, có log) — xem `usePersonaForm`.
  phone: '',
  email: customer.email,
  nationalId: '',
  areaId: customer.area?.id ?? '',
  sourceId: customer.source?.id ?? '',
  interestedProjectIds: customer.projects.map((project) => project.id),
  tagIds: customer.tags.map((tag) => tag.id),
  notes: customer.notes,
});

/** `isPhoneLocked`: chưa lấy số đầy đủ (chưa bấm "Sửa số") -> không kiểm/không gửi SĐT. */
export const validateBasicInfo = (values: BasicInfoValues, isPhoneLocked = false): FormErrors<BasicInfoField> => {
  const errors: FormErrors<BasicInfoField> = {};
  const fullNameError = getFullNameError(values.fullName);
  if (fullNameError) errors.fullName = fullNameError;
  const phoneError = isPhoneLocked ? undefined : getPhoneFormatError(values.phone);
  if (phoneError) errors.phone = phoneError;
  if (!isValidOptionalEmail(values.email)) errors.email = 'Email không hợp lệ (VD: khachhang@stnd.vn).';
  if (!isValidNationalId(values.nationalId)) errors.nationalId = 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).';
  return errors;
};

/** Body `PATCH /crm/customers/:id` (khu vực = nơi ở, sửa được sau khi tạo — C1). */
export const toUpdateCustomerInput = (values: BasicInfoValues, version: number, isPhoneLocked = false): UpdateCustomerInput => ({
  version,
  fullName: values.fullName,
  phone: isPhoneLocked ? undefined : values.phone,
  email: values.email,
  areaId: values.areaId || null,
  sourceId: values.sourceId || null,
  interestedProjectIds: values.interestedProjectIds,
  tagIds: values.tagIds,
  notes: values.notes,
});

// ---------------------------------------------------------------------------
// Chân dung động
// ---------------------------------------------------------------------------

/** Giá trị nháp của 1 trường (đơn vị form: ngân sách = tỷ). */
export interface PersonaDraftValue {
  text: string;
  date: string;
  options: string[];
  isOn: boolean;
  from: number;
  to: number;
}

export type PersonaDraft = Record<string, PersonaDraftValue>;

const emptyDraftValue = (): PersonaDraftValue => ({ text: '', date: '', options: [], isOn: false, from: 0, to: 0 });

export const fieldsOfGroups = (fields: readonly PersonaFieldDefinition[], groupCodes: readonly PersonaGroupCode[]): PersonaFieldDefinition[] =>
  fields.filter((field) => field.isActive && groupCodes.includes(field.groupCode));

/** PersonaValue[] -> bản nháp form cho các trường được chỉ định. */
export const toPersonaDraft = (persona: readonly PersonaValue[], fields: readonly PersonaFieldDefinition[]): PersonaDraft =>
  Object.fromEntries(
    fields.map((field) => {
      const value = findPersonaValue(persona, field.key);
      return [
        field.key,
        {
          text: value?.valueText ?? '',
          date: value?.valueDate ?? '',
          options: value?.valueOptions ?? [],
          isOn: value?.valueBoolean ?? false,
          from: value?.valueNumber ? vndToBillion(value.valueNumber) : 0,
          to: value?.valueNumberTo ? vndToBillion(value.valueNumberTo) : 0,
        },
      ];
    }),
  );

export const getDraftValue = (draft: PersonaDraft, fieldKey: string): PersonaDraftValue => draft[fieldKey] ?? emptyDraftValue();

/** Lỗi trường chân dung (chỉ kiểm định dạng; không có trường bắt buộc — QT9). */
export const validatePersonaDraft = (draft: PersonaDraft, fields: readonly PersonaFieldDefinition[]): Record<string, string> => {
  const errors: Record<string, string> = {};
  fields.forEach((field) => {
    const value = getDraftValue(draft, field.key);
    if (field.type === 'NUMBER_RANGE') {
      if (value.from < 0 || value.to < 0 || !Number.isFinite(value.from) || !Number.isFinite(value.to)) errors[field.key] = 'Số tiền không hợp lệ.';
      else if (value.from > 0 && value.to > 0 && value.from > value.to) errors[field.key] = 'Mức tối đa phải lớn hơn hoặc bằng mức tối thiểu.';
    }
  });
  return errors;
};

/** Bản nháp -> body `PATCH persona` (`value: null` = xoá). Lớp dữ liệu chỉ ghi metadata cho trường thật sự đổi. */
export const toPersonaInputs = (
  draft: PersonaDraft,
  fields: readonly PersonaFieldDefinition[],
  source: Exclude<PersonaSource, 'IMPORTED'>,
): PersonaValueInput[] =>
  fields.map((field) => {
    const value = getDraftValue(draft, field.key);
    switch (field.type) {
      case 'DATE':
        return { fieldKey: field.key, source, value: value.date ? { valueDate: value.date } : null };
      case 'MULTI_SELECT':
        return { fieldKey: field.key, source, value: value.options.length > 0 ? { valueOptions: value.options } : null };
      case 'BOOLEAN':
        return { fieldKey: field.key, source, value: value.isOn ? { valueBoolean: true } : null };
      case 'NUMBER_RANGE':
        return {
          fieldKey: field.key,
          source,
          value: value.from > 0 || value.to > 0 ? { valueNumber: billionToVnd(value.from), valueNumberTo: billionToVnd(value.to) } : null,
        };
      default:
        return { fieldKey: field.key, source, value: value.text.trim() ? { valueText: value.text.trim() } : null };
    }
  });
