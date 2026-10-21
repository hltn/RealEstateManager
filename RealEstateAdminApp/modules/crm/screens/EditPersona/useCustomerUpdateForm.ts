/**
 * Hook form sửa hồ sơ khách dùng chung (Chân dung, Thông tin đầu tư - cả desktop lẫn mobile):
 * state cục bộ -> validate -> `updateCustomer(id, changes, { toastTitle })` -> `goBack()` (theo README).
 *
 * TODO(đề xuất): chuyển sang `src/hooks/useCustomerUpdateForm.ts` khi được phép sửa ngoài thư mục màn.
 */
import { useState, type FormEvent } from 'react';
import { useCrmActions, type CustomerChanges } from '@crm/store';
import { getFirstError, type FormErrors } from '../CreateCustomer/customerFormRules';

interface CustomerUpdateFormOptions<TValues extends object> {
  customerId: string;
  initialValues: TValues | (() => TValues);
  validate: (values: TValues) => FormErrors<Extract<keyof TValues, string>>;
  /** Thứ tự trường để toast báo lỗi đầu tiên. */
  fieldOrder: readonly Extract<keyof TValues, string>[];
  toChanges: (values: TValues) => CustomerChanges;
  successToastTitle: string;
  errorToastTitle: string;
}

export interface CustomerUpdateFormApi<TValues extends object> {
  values: TValues;
  errors: FormErrors<Extract<keyof TValues, string>>;
  setField: <K extends Extract<keyof TValues, string>>(field: K, value: TValues[K]) => void;
  /** Cập nhật theo hàm (dùng cho thao tác mảng: thêm/xoá tag, dự án...). */
  updateValues: (updater: (current: TValues) => TValues) => void;
  submit: (event?: FormEvent) => boolean;
  cancel: () => void;
}

export const useCustomerUpdateForm = <TValues extends object>({
  customerId,
  initialValues,
  validate,
  fieldOrder,
  toChanges,
  successToastTitle,
  errorToastTitle,
}: CustomerUpdateFormOptions<TValues>): CustomerUpdateFormApi<TValues> => {
  const { updateCustomer, goBack, showToast } = useCrmActions();
  const [values, setValues] = useState<TValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors<Extract<keyof TValues, string>>>({});

  return {
    values,
    errors,
    setField: (field, value) => {
      setValues((current) => ({ ...current, [field]: value }));
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    },
    updateValues: setValues,
    submit: (event) => {
      event?.preventDefault();
      const nextErrors = validate(values);
      setErrors(nextErrors);
      const firstError = getFirstError(nextErrors, fieldOrder);
      if (firstError) {
        showToast({ type: 'error', title: errorToastTitle, message: firstError });
        return false;
      }
      updateCustomer(customerId, toChanges(values), { toastTitle: successToastTitle });
      goBack();
      return true;
    },
    cancel: goBack,
  };
};
