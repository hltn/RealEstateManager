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
  requestJoin: () => void;
  submit: (event?: FormEvent) => boolean;
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

  // Kiểm trùng ngay khi SĐT hợp lệ (mô phỏng `POST phone-lookups`); tự làm mới khi trạng thái đề nghị đổi.
  const phoneLookup = usePhoneLookup(values.phone);

  const setField: CreateCustomerFormApi['setField'] = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const submit: CreateCustomerFormApi['submit'] = (event) => {
    event?.preventDefault();
    const nextErrors = validateCreateCustomer(values);
    if (phoneLookup?.exists) nextErrors.phone = 'Số điện thoại đã có trong hệ thống.';
    setErrors(nextErrors);
    const firstError = getFirstError(nextErrors, CREATE_CUSTOMER_FIELD_ORDER);
    if (firstError) {
      showToast({ type: 'error', title: 'Chưa thể lưu khách hàng', message: firstError });
      return false;
    }
    const result = api.createCustomer(toCreateCustomerInput(values));
    if (!result.ok) {
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
    setField,
    toggleProject: (projectId) => setValues((current) => ({ ...current, interestedProjectIds: toggleItem(current.interestedProjectIds, projectId) })),
    toggleMember: (userId) => setValues((current) => ({ ...current, memberIds: toggleItem(current.memberIds, userId) })),
    requestJoin: () => {
      if (!phoneLookup?.customerRef) return;
      const result = api.createCareTeamRequest({ customerRef: phoneLookup.customerRef });
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
