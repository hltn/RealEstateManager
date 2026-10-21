import { useCrmActions, useCrmState } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { findCustomerByPhone } from '../CreateCustomer/customerFormRules';
import {
  addLifestyleTag,
  PERSONA_FIELD_ORDER,
  toPersonaChanges,
  toPersonaFormValues,
  validatePersona,
  type PersonaFormValues,
} from './personaForm';
import { useCustomerUpdateForm, type CustomerUpdateFormApi } from './useCustomerUpdateForm';

export interface PersonaFormApi extends CustomerUpdateFormApi<PersonaFormValues> {
  /** Khách KHÁC đang dùng SĐT vừa nhập (đối soát trực tiếp khi gõ) hoặc `null`. */
  duplicateCustomer: Customer | null;
  openDuplicateCustomer: () => void;
  addTag: (rawTag: string) => void;
  removeTag: (tag: string) => void;
}

/** Logic form chân dung dùng chung cho desktop + mobile. */
export const usePersonaForm = (customer: Customer): PersonaFormApi => {
  const { customers } = useCrmState();
  const { selectCustomer } = useCrmActions();
  const form = useCustomerUpdateForm<PersonaFormValues>({
    customerId: customer.id,
    initialValues: () => toPersonaFormValues(customer),
    validate: (values) => validatePersona(values, customers, customer.id),
    fieldOrder: PERSONA_FIELD_ORDER,
    toChanges: (values) => toPersonaChanges(values, customer),
    successToastTitle: 'Đã cập nhật Chân dung khách hàng thành công!',
    errorToastTitle: 'Chưa thể lưu chân dung',
  });
  const duplicateCustomer = findCustomerByPhone(customers, form.values.phone, customer.id);

  return {
    ...form,
    duplicateCustomer,
    openDuplicateCustomer: () => {
      if (duplicateCustomer) selectCustomer(duplicateCustomer.id);
    },
    addTag: (rawTag) =>
      form.updateValues((current) => ({ ...current, lifestyleTags: addLifestyleTag(current.lifestyleTags, rawTag) })),
    removeTag: (tag) =>
      form.updateValues((current) => ({
        ...current,
        lifestyleTags: current.lifestyleTags.filter((existing) => existing !== tag),
      })),
  };
};
