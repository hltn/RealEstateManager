import { useState, type FormEvent } from 'react';
import { useCrmActions, useCrmState } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import {
  CREATE_CUSTOMER_FIELD_ORDER,
  buildNewCustomerInput,
  createDefaultFormValues,
  validateCreateCustomer,
  type CreateCustomerField,
  type CreateCustomerFormValues,
} from './createCustomerForm';
import { findCustomerByPhone, getFirstError, toggleItem, type FormErrors } from './customerFormRules';

export interface CreateCustomerFormApi {
  values: CreateCustomerFormValues;
  errors: FormErrors<CreateCustomerField>;
  /** Khách đã có cùng SĐT (đối soát trực tiếp khi gõ) hoặc `null`. */
  duplicateCustomer: Customer | null;
  setField: <K extends CreateCustomerField>(field: K, value: CreateCustomerFormValues[K]) => void;
  toggleProject: (projectName: string) => void;
  /** Kiểm tra + lưu. Trả `true` nếu đã tạo khách. */
  submit: (event?: FormEvent) => boolean;
  cancel: () => void;
  openDuplicateCustomer: () => void;
}

/**
 * Logic form "Thêm khách hàng mới" dùng chung cho desktop + mobile:
 * state cục bộ của form -> validate -> `addCustomer` (store tự chọn khách, mở chi tiết, hiện toast).
 */
export const useCreateCustomerForm = (): CreateCustomerFormApi => {
  const { customers } = useCrmState();
  const { addCustomer, goBack, selectCustomer, showToast } = useCrmActions();
  const [values, setValues] = useState<CreateCustomerFormValues>(createDefaultFormValues);
  const [errors, setErrors] = useState<FormErrors<CreateCustomerField>>({});

  const duplicateCustomer = findCustomerByPhone(customers, values.phone);

  const setField: CreateCustomerFormApi['setField'] = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    // Sửa trường nào thì xoá lỗi trường đó (lỗi khác giữ nguyên tới lần lưu sau).
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const submit: CreateCustomerFormApi['submit'] = (event) => {
    event?.preventDefault();
    const nextErrors = validateCreateCustomer(values, customers);
    setErrors(nextErrors);
    const firstError = getFirstError(nextErrors, CREATE_CUSTOMER_FIELD_ORDER);
    if (firstError) {
      showToast({ type: 'error', title: 'Chưa thể lưu khách hàng', message: firstError });
      return false;
    }
    addCustomer(buildNewCustomerInput(values));
    return true;
  };

  return {
    values,
    errors,
    duplicateCustomer,
    setField,
    toggleProject: (projectName) =>
      setValues((current) => ({ ...current, interestedProjects: toggleItem(current.interestedProjects, projectName) })),
    submit,
    cancel: goBack,
    openDuplicateCustomer: () => {
      if (duplicateCustomer) selectCustomer(duplicateCustomer.id);
    },
  };
};
