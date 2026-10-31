/**
 * Hook form sửa hồ sơ + chân dung (dùng chung màn "Chân dung khách hàng" và "Nhu cầu BĐS", desktop + mobile).
 * Luồng lưu: kiểm form -> `saveCustomerProfile` (hồ sơ -> chân dung -> CCCD mới; CHỈ gửi phần thật sự đổi) -> quay lại chi tiết.
 * "Xoá CCCD" là hành động riêng có xác nhận. Số điện thoại đầy đủ chỉ lấy khi bấm "Sửa số" (server ghi `PHONE_VIEWED`).
 * Xung đột phiên bản (409): báo rõ và tải lại dữ liệu, KHÔNG ghi đè thay đổi của người khác.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { describeWriteError, useCatalogs, useCrmApi, usePhoneLookup, type CustomerDetail, type CustomerPersonaView, type PersonaValueInput, type PhoneLookupResult } from '@crm/api';
import { formatPhoneDisplay, normalizePhone } from '@crm/lib/phone';
import { useCrmActions } from '@crm/store';
import type { PersonaGroupCode, PersonaSource, TagCategory } from '@crm/types/crm';
import { useRevealedValue } from '../CustomerDetail/useRevealedValue';
import { getFirstError, toggleItem, type FormErrors } from '../CreateCustomer/customerFormRules';
import {
  BASIC_FIELD_ORDER,
  fieldsOfGroups,
  getChangedBasicInput,
  getChangedPersonaInputs,
  getDraftValue,
  toBasicInfoValues,
  toPersonaDraft,
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

export const usePersonaForm = (customer: CustomerDetail, persona: CustomerPersonaView, { groupCodes, hasBasicInfo, successToastTitle }: PersonaFormOptions) => {
  const api = useCrmApi();
  const { goBack, showToast } = useCrmActions();
  const { personaFields } = useCatalogs();
  const fields = useMemo(() => fieldsOfGroups(personaFields, groupCodes), [personaFields, groupCodes]);
  // Bản gốc để so sánh: chỉ gửi trường thật sự đổi (tránh ghi đè/ xóa giá trị người khác vừa sửa).
  const [initialBasic] = useState<BasicInfoValues>(() => toBasicInfoValues(customer));
  const [initialDraft] = useState<PersonaDraft>(() => toPersonaDraft(persona.values, fields));
  const [basic, setBasic] = useState<BasicInfoValues>(initialBasic);
  const [draft, setDraft] = useState<PersonaDraft>(initialDraft);
  const [source, setSource] = useState<Exclude<PersonaSource, 'IMPORTED'>>('CUSTOMER_SHARED');
  const [basicErrors, setBasicErrors] = useState<FormErrors<BasicInfoField>>({});
  const [personaErrors, setPersonaErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  /** Số đầy đủ chỉ có sau khi bấm "Sửa số" (createPhoneView ghi log); trước đó ô SĐT khoá và không gửi SĐT khi lưu. */
  const [revealedPhone, setRevealedPhone] = useRevealedValue(customer.id);
  const isPhoneLocked = revealedPhone === null;
  const isPhoneChanged = hasBasicInfo && !isPhoneLocked && normalizePhone(basic.phone) !== revealedPhone;
  const lookup = usePhoneLookup(isPhoneLocked ? '' : basic.phone, customer.id);
  const phoneLookup: PhoneLookupResult | null = isPhoneChanged ? lookup : null;

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    if (isSaving) return false;
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

    const profile = hasBasicInfo ? getChangedBasicInput(initialBasic, basic, isPhoneLocked, revealedPhone) : undefined;
    const personaValues: PersonaValueInput[] = getChangedPersonaInputs(initialDraft, draft, fields, source);
    const nationalId = hasBasicInfo && basic.nationalId.trim() ? basic.nationalId : undefined;
    if (!profile && !nationalId && personaValues.length === 0) {
      showToast({ type: 'info', title: 'Chưa có thay đổi nào để lưu' });
      return false;
    }

    setIsSaving(true);
    const result = await api.saveCustomerProfile(customer.id, { version: customer.version, profile, nationalId, personaValues });
    setIsSaving(false);
    if (!result.ok) {
      // Dữ liệu vẫn được tải lại nhưng form GIỮ NGUYÊN những gì đang nhập; bấm Lưu lần nữa sẽ gửi phần đã sửa với version mới.
      showToast({ type: 'error', title: describeWriteError(result.error) });
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
    phoneLookup,
    isPhoneLocked,
    isSaving,
    phoneMasked: customer.phoneMasked,
    /** Bấm "Sửa số": lấy số đầy đủ qua `createPhoneView` (kiểm phạm vi + ghi 1 log) rồi mở khoá ô SĐT. Gọi trong handler. */
    revealPhone: async () => {
      const result = await api.createPhoneView(customer.id, 'VIEW');
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      setRevealedPhone(result.data.phone);
      setBasic((current) => ({ ...current, phone: formatPhoneDisplay(result.data.phone) }));
    },
    hasNationalId: customer.hasNationalId,
    setBasicField: <K extends BasicInfoField>(field: K, value: BasicInfoValues[K]) => {
      setBasic((current) => ({ ...current, [field]: value }));
      setBasicErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    },
    toggleProject: (projectId: string) => setBasic((current) => ({ ...current, interestedProjectIds: toggleItem(current.interestedProjectIds, projectId) })),
    toggleTag: (tagId: string) => setBasic((current) => ({ ...current, tagIds: toggleItem(current.tagIds, tagId) })),
    /** Gắn nhanh thẻ mới (C11): tạo thẻ (hoặc dùng thẻ trùng tên) rồi gắn cho khách. */
    addNewTag: async (name: string, category: TagCategory) => {
      const result = await api.createTag({ name, category });
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      setBasic((current) => ({ ...current, tagIds: current.tagIds.includes(result.data.id) ? current.tagIds : [...current.tagIds, result.data.id] }));
    },
    getValue: (fieldKey: string) => getDraftValue(draft, fieldKey),
    setValue: (fieldKey: string, value: PersonaDraftValue) => setDraft((current) => ({ ...current, [fieldKey]: value })),
    setSource,
    /** Xoá CCCD đã lưu (UI phải xác nhận trước khi gọi). */
    deleteNationalId: async () => {
      const result = await api.deleteNationalId(customer.id);
      showToast(result.ok ? { title: 'Đã xoá CCCD của khách' } : { type: 'error', title: result.error.message });
      return result.ok;
    },
    requestJoin: async () => {
      if (!phoneLookup?.customerRef) return;
      const result = await api.createCareTeamRequest({ customerRef: phoneLookup.customerRef });
      showToast(result.ok ? { title: 'Đã gửi đề nghị tham gia nhóm chăm sóc' } : { type: 'error', title: result.error.message });
    },
    submit,
    cancel: goBack,
  };
};

export type PersonaFormApi = ReturnType<typeof usePersonaForm>;
