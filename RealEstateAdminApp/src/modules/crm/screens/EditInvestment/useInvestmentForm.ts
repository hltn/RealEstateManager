import type { Customer } from '@crm/types/crm';
import { addUniqueItem } from '../CreateCustomer/customerFormRules';
import { useCustomerUpdateForm, type CustomerUpdateFormApi } from '../EditPersona/useCustomerUpdateForm';
import {
  INVESTMENT_FIELD_ORDER,
  toInvestmentChanges,
  toInvestmentFormValues,
  validateInvestment,
  type InvestmentFormValues,
} from './investmentForm';

/** Trường dạng danh sách (thêm/xoá bằng TagInput). */
export type InvestmentListField = 'interestedProjects' | 'purchasePurposes' | 'criteriaPriorities';

export interface InvestmentFormApi extends CustomerUpdateFormApi<InvestmentFormValues> {
  addItem: (field: InvestmentListField, rawValue: string) => void;
  removeItem: (field: InvestmentListField, value: string) => void;
}

/** Logic form Thông tin đầu tư dùng chung desktop + mobile. Lưu -> `updateCustomer` + toast + `goBack`. */
export const useInvestmentForm = (customer: Customer): InvestmentFormApi => {
  const form = useCustomerUpdateForm<InvestmentFormValues>({
    customerId: customer.id,
    initialValues: () => toInvestmentFormValues(customer),
    validate: validateInvestment,
    fieldOrder: INVESTMENT_FIELD_ORDER,
    toChanges: toInvestmentChanges,
    successToastTitle: 'Đã cập nhật Thông tin đầu tư thành công!',
    errorToastTitle: 'Chưa thể lưu thông tin đầu tư',
  });

  return {
    ...form,
    // setField còn xoá lỗi của trường (vd "chưa chọn dự án") ngay khi người dùng thêm mục.
    addItem: (field, rawValue) => form.setField(field, addUniqueItem(form.values[field], rawValue)),
    removeItem: (field, value) => form.setField(field, form.values[field].filter((item) => item !== value)),
  };
};
