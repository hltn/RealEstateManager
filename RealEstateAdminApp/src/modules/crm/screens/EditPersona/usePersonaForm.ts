/**
 * Hook form sửa hồ sơ + chân dung (dùng chung màn "Chân dung khách hàng" và "Nhu cầu BĐS", desktop + mobile).
 * Luồng lưu: kiểm form -> `saveCustomerProfile` (hồ sơ + CCCD mới + chân dung trong MỘT mutation nguyên tử,
 * ghi nguồn + người + ngày cho trường đổi) -> quay lại chi tiết. "Xoá CCCD" là hành động riêng có xác nhận.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useCrmApi, useCustomerPersona, usePhoneLookup, type CustomerDetail, type PhoneLookupResult } from '@crm/api';
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import { normalizePhone } from '@crm/lib/phone';
import { useCrmActions } from '@crm/store';
import type { PersonaGroupCode, PersonaSource, TagCategory } from '@crm/types/crm';
import { getFirstError, toggleItem, type FormErrors } from '../CreateCustomer/customerFormRules';
import {
  BASIC_FIELD_ORDER,
  fieldsOfGroups,
  getDraftValue,
  toBasicInfoValues,
  toPersonaDraft,
  toPersonaInputs,
  toUpdateCustomerInput,
  validateBasicInfo,
  validatePersonaDraft,
  type BasicInfoField,
  type BasicInfoValues,
  type PersonaDraft,
  type PersonaDraftValue,
} from './personaForm';

interface PersonaFormOptions {
  groupCodes: readonly PersonaGroupCode[];
  /** Có phần thông tin cơ bản (họ tên, SĐT, khu vực, nguồn, dự án, thẻ, CCCD) không. */
  hasBasicInfo: boolean;
  successToastTitle: string;
}

export const usePersonaForm = (customer: CustomerDetail, { groupCodes, hasBasicInfo, successToastTitle }: PersonaFormOptions) => {
  const api = useCrmApi();
  const { goBack, showToast } = useCrmActions();
  const { data: persona } = useCustomerPersona(customer.id);
  const fields = useMemo(() => fieldsOfGroups(PERSONA_FIELDS, groupCodes), [groupCodes]);
  const [basic, setBasic] = useState<BasicInfoValues>(() => toBasicInfoValues(customer));
  const [draft, setDraft] = useState<PersonaDraft>(() => toPersonaDraft(persona?.values ?? [], fields));
  const [source, setSource] = useState<Exclude<PersonaSource, 'IMPORTED'>>('CUSTOMER_SHARED');
  const [shouldRemindOccasions, setShouldRemindOccasions] = useState(customer.shouldRemindOccasions);
  const [basicErrors, setBasicErrors] = useState<FormErrors<BasicInfoField>>({});
  const [personaErrors, setPersonaErrors] = useState<Record<string, string>>({});

  const isPhoneLocked = customer.isPhoneMasked;
  const isPhoneChanged = hasBasicInfo && !isPhoneLocked && normalizePhone(basic.phone) !== customer.phone;
  const lookup = usePhoneLookup(basic.phone, customer.id);
  const phoneLookup: PhoneLookupResult | null = isPhoneChanged ? lookup : null;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const nextBasicErrors = hasBasicInfo ? validateBasicInfo(basic, isPhoneLocked) : {};
    if (phoneLookup?.exists) nextBasicErrors.phone = 'Số điện thoại đã có trong hệ thống.';
    const nextPersonaErrors = validatePersonaDraft(draft, fields);
    setBasicErrors(nextBasicErrors);
    setPersonaErrors(nextPersonaErrors);
    const firstError = getFirstError(nextBasicErrors, BASIC_FIELD_ORDER) ?? Object.values(nextPersonaErrors)[0];
    if (firstError) {
      showToast({ type: 'error', title: 'Chưa thể lưu', message: firstError });
      return false;
    }

    // MỘT mutation nguyên tử: kiểm tất cả rồi mới ghi (1 version, 1 changeLog); lỗi -> không ghi gì.
    const result = api.saveCustomerProfile(customer.id, {
      version: customer.version,
      profile: hasBasicInfo ? (({ version: _version, ...rest }) => ({ ...rest, shouldRemindOccasions }))(toUpdateCustomerInput(basic, customer.version, isPhoneLocked)) : undefined,
      nationalId: hasBasicInfo ? basic.nationalId : undefined,
      personaValues: toPersonaInputs(draft, fields, source),
    });
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return false;
    }
    showToast({ title: successToastTitle });
    goBack();
    return true;
  };

  return {
    fields,
    basic,
    basicErrors,
    draft,
    personaErrors,
    source,
    shouldRemindOccasions,
    phoneLookup,
    hasNationalId: customer.hasNationalId,
    isPhoneLocked,
    setBasicField: <K extends BasicInfoField>(field: K, value: BasicInfoValues[K]) => {
      setBasic((current) => ({ ...current, [field]: value }));
      setBasicErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    },
    toggleProject: (projectId: string) => setBasic((current) => ({ ...current, interestedProjectIds: toggleItem(current.interestedProjectIds, projectId) })),
    toggleTag: (tagId: string) => setBasic((current) => ({ ...current, tagIds: toggleItem(current.tagIds, tagId) })),
    /** Gắn nhanh thẻ mới (C11): tạo thẻ (hoặc dùng thẻ trùng tên) rồi gắn cho khách. */
    addNewTag: (name: string, category: TagCategory) => {
      const result = api.createTag({ name, category });
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      setBasic((current) => ({ ...current, tagIds: current.tagIds.includes(result.data.id) ? current.tagIds : [...current.tagIds, result.data.id] }));
    },
    getValue: (fieldKey: string) => getDraftValue(draft, fieldKey),
    setValue: (fieldKey: string, value: PersonaDraftValue) => setDraft((current) => ({ ...current, [fieldKey]: value })),
    setSource,
    setShouldRemindOccasions,
    /** Xoá CCCD đã lưu (UI phải xác nhận trước khi gọi). */
    deleteNationalId: () => {
      const result = api.deleteNationalId(customer.id);
      showToast(result.ok ? { title: 'Đã xoá CCCD của khách' } : { type: 'error', title: result.error.message });
      return result.ok;
    },
    requestJoin: () => {
      if (!phoneLookup?.customerRef) return;
      const result = api.createCareTeamRequest({ customerRef: phoneLookup.customerRef });
      showToast(result.ok ? { title: 'Đã gửi đề nghị tham gia nhóm chăm sóc' } : { type: 'error', title: result.error.message });
    },
    submit,
    cancel: goBack,
  };
};

export type PersonaFormApi = ReturnType<typeof usePersonaForm>;
