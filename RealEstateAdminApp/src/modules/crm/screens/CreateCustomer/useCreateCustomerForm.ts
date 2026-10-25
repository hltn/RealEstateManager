import { useState, type FormEvent } from 'react';
import { useCatalogs, useCrmActor, useCrmApi, usePhoneLookup, type PhoneLookupResult } from '@crm/api';
import { getDefaultStatus } from '@crm/lib/customerRules';
import { useCrmActions } from '@crm/store';
import {
  CREATE_CUSTOMER_FIELD_ORDER,
  createDefaultFormValues,
  toCreateCustomerInput,
  validateCreateCustomer,
  type CreateCustomerField,
  type CreateCustomerFormValues,
} from './createCustomerForm';
import { getFirstError, toggleItem, type FormErrors } from './customerFormRules';

export interface CreateCustomerFormApi {
  values: CreateCustomerFormValues;
  errors: FormErrors<CreateCustomerField>;
  /** Kết quả kiểm trùng SĐT (X2) khi SĐT đã hợp lệ; null = chưa kiểm/chưa hợp lệ. */
  phoneLookup: PhoneLookupResult | null;
  /** Nhân viên luôn là phụ trách chính khách mình tạo -> khoá ô chọn. */
  isPrimaryLocked: boolean;
  setField: <K extends CreateCustomerField>(field: K, value: CreateCustomerFormValues[K]) => void;
  toggleProject: (projectId: string) => void;
  toggleMember: (userId: string) => void;
  requestJoin: () => Promise<void>;
  submit: (event?: FormEvent) => Promise<boolean>;
  isSubmitting: boolean;
  cancel: () => void;
}

/**
 * Logic form "Thêm khách hàng mới" (desktop + mobile): state cục bộ -> validate -> `POST /crm/customers`
 * -> mở chi tiết khách vừa tạo. Trùng SĐT: chỉ báo "do [tên] chăm sóc" + đề nghị tham gia nhóm (không lộ thông tin khách).
 */
export const useCreateCustomerForm = (): CreateCustomerFormApi => {
  const api = useCrmApi();
  const actor = useCrmActor();
  const { catalogs } = useCatalogs();
  const { goBack, selectCustomer, showToast } = useCrmActions();
  const [values, setValues] = useState<CreateCustomerFormValues>(() =>
    createDefaultFormValues({ statusId: getDefaultStatus(catalogs.statuses)?.id ?? '', currentUserId: actor.role === 'ADMIN' ? '' : actor.userId }),
  );
  const [errors, setErrors] = useState<FormErrors<CreateCustomerField>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Trùng SĐT do server báo khi lưu (409 `CUSTOMER_PHONE_DUPLICATED`), gắn với SĐT lúc báo. */
  const [serverDuplicate, setServerDuplicate] = useState<{ phone: string; lookup: PhoneLookupResult } | null>(null);

  // Kiểm trùng khi SĐT hợp lệ (`POST phone-lookups`, đã debounce); kết quả 409 từ server dùng khi lookup chưa có (vd bị giới hạn 429).
  const lookupResult = usePhoneLookup(values.phone);
  const phoneLookup = lookupResult ?? (serverDuplicate?.phone === values.phone ? serverDuplicate.lookup : null);

  const setField: CreateCustomerFormApi['setField'] = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const submit: CreateCustomerFormApi['submit'] = async (event) => {
    event?.preventDefault();
    if (isSubmitting) return false;
    const nextErrors = validateCreateCustomer(values);
    if (phoneLookup?.exists) nextErrors.phone = 'Số điện thoại đã có trong hệ thống.';
    setErrors(nextErrors);
    const firstError = getFirstError(nextErrors, CREATE_CUSTOMER_FIELD_ORDER);
    if (firstError) {
      showToast({ type: 'error', title: 'Chưa thể lưu khách hàng', message: firstError });
      return false;
    }
    setIsSubmitting(true);
    const result = await api.createCustomer(toCreateCustomerInput(values, actor.role));
    setIsSubmitting(false);
    if (!result.ok) {
      if (result.error.errorCode === 'CUSTOMER_PHONE_DUPLICATED' && result.error.details) {
        const details = result.error.details as Partial<PhoneLookupResult>;
        setServerDuplicate({
          phone: values.phone,
          lookup: {
            normalizedPhone: '',
            exists: true,
            isAccessible: Boolean(details.isAccessible),
            customerId: details.customerId,
            customerRef: details.customerRef,
            caredByName: details.caredByName ?? null,
            canRequestJoin: Boolean(details.canRequestJoin),
            hasPendingRequest: false,
          },
        });
        setErrors((current) => ({ ...current, phone: 'Số điện thoại đã có trong hệ thống.' }));
      }
      showToast({ type: 'error', title: 'Chưa thể lưu khách hàng', message: result.error.message });
      return false;
    }
    showToast({ title: 'Thêm khách hàng thành công', message: `${result.data.fullName} đã được thêm vào hệ thống.` });
    // replace: nút Back không quay về form trống.
    selectCustomer(result.data.id, { shouldReplace: true });
    return true;
  };

  return {
    values,
    errors,
    phoneLookup,
    isPrimaryLocked: actor.role === 'STAFF',
    isSubmitting,
    setField,
    toggleProject: (projectId) => setValues((current) => ({ ...current, interestedProjectIds: toggleItem(current.interestedProjectIds, projectId) })),
    toggleMember: (userId) => setValues((current) => ({ ...current, memberIds: toggleItem(current.memberIds, userId) })),
    requestJoin: async () => {
      if (!phoneLookup?.customerRef) return;
      const result = await api.createCareTeamRequest({ customerRef: phoneLookup.customerRef });
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return;
      }
      showToast({ title: 'Đã gửi đề nghị tham gia nhóm chăm sóc', message: 'Người phụ trách chính hoặc quản lý sẽ duyệt.' });
    },
    submit,
    cancel: goBack,
  };
};
