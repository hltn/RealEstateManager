import { useState, type FormEvent } from 'react';
import { useCatalogs, useCrmApi } from '@crm/api';
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
  setField: <K extends CreateCustomerField>(field: K, value: CreateCustomerFormValues[K]) => void;
  toggleProject: (projectId: string) => void;
  submit: (event?: FormEvent) => Promise<boolean>;
  isSubmitting: boolean;
  cancel: () => void;
}

/**
 * Logic form "Thêm khách hàng mới" (desktop + mobile): state cục bộ -> validate -> `POST /crm/customers`
 * -> mở chi tiết khách vừa tạo. v1.0.5: SĐT tuỳ chọn và được trùng; người tạo tự là phụ trách chính (không chọn nhóm khi tạo).
 */
export const useCreateCustomerForm = (): CreateCustomerFormApi => {
  const api = useCrmApi();
  const { catalogs } = useCatalogs();
  const { goBack, selectCustomer, showToast } = useCrmActions();
  const [values, setValues] = useState<CreateCustomerFormValues>(() =>
    createDefaultFormValues({ statusId: getDefaultStatus(catalogs.statuses)?.id ?? '' }),
  );
  const [errors, setErrors] = useState<FormErrors<CreateCustomerField>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField: CreateCustomerFormApi['setField'] = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const submit: CreateCustomerFormApi['submit'] = async (event) => {
    event?.preventDefault();
    if (isSubmitting) return false;
    const nextErrors = validateCreateCustomer(values);
    setErrors(nextErrors);
    const firstError = getFirstError(nextErrors, CREATE_CUSTOMER_FIELD_ORDER);
    if (firstError) {
      showToast({ type: 'error', title: 'Chưa thể lưu khách hàng', message: firstError });
      return false;
    }
    setIsSubmitting(true);
    const result = await api.createCustomer(toCreateCustomerInput(values));
    setIsSubmitting(false);
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
    isSubmitting,
    setField,
    toggleProject: (projectId) => setValues((current) => ({ ...current, interestedProjectIds: toggleItem(current.interestedProjectIds, projectId) })),
    submit,
    cancel: goBack,
  };
};
