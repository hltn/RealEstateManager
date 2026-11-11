/**
 * Mô hình form "Thêm khách hàng mới" dùng chung desktop + mobile.
 * Giá trị mặc định RỖNG (không điền sẵn dữ liệu mẫu); tình trạng mặc định lấy từ danh mục (`isDefault` = "Chưa tiếp cận").
 * v1.0.5: KHÔNG chọn nhóm chăm sóc khi tạo; người tạo tự là phụ trách chính (mọi vai trò). SĐT tuỳ chọn.
 */
import type { CreateCustomerInput } from '@crm/api';
import { isValidNationalId } from '@crm/lib/customerRules';
import { getFullNameError, getPhoneFormatError, isValidOptionalEmail, type FormErrors } from './customerFormRules';

export interface CreateCustomerFormValues {
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  areaId: string;
  interestedProjectIds: string[];
  statusId: string;
  sourceId: string;
}

export type CreateCustomerField = keyof CreateCustomerFormValues;

/** Thứ tự kiểm tra (= thứ tự hiển thị trên form) để toast báo lỗi đầu tiên. */
export const CREATE_CUSTOMER_FIELD_ORDER: readonly CreateCustomerField[] = ['fullName', 'phone', 'email', 'nationalId'];

export const createDefaultFormValues = (defaults: { statusId: string }): CreateCustomerFormValues => ({
  fullName: '',
  phone: '',
  email: '',
  nationalId: '',
  areaId: '',
  interestedProjectIds: [],
  statusId: defaults.statusId,
  sourceId: '',
});

/** Kiểm tra form (chỉ họ tên bắt buộc; SĐT có nhập thì phải hợp lệ). */
export const validateCreateCustomer = (values: CreateCustomerFormValues): FormErrors<CreateCustomerField> => {
  const errors: FormErrors<CreateCustomerField> = {};
  const fullNameError = getFullNameError(values.fullName);
  if (fullNameError) errors.fullName = fullNameError;
  const phoneError = getPhoneFormatError(values.phone);
  if (phoneError) errors.phone = phoneError;
  if (!isValidOptionalEmail(values.email)) errors.email = 'Email không hợp lệ (VD: khachhang@stnd.vn).';
  if (!isValidNationalId(values.nationalId)) errors.nationalId = 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).';
  return errors;
};

/**
 * Form hợp lệ -> body `POST /crm/customers`. KHÔNG gửi `careTeam` (server tự đặt người tạo làm phụ trách chính, mọi vai trò).
 * SĐT rỗng -> `null` (khách chưa có số).
 */
export const toCreateCustomerInput = (values: CreateCustomerFormValues): CreateCustomerInput => ({
  fullName: values.fullName.trim(),
  phone: values.phone.trim() || null,
  email: values.email.trim(),
  nationalId: values.nationalId.trim() || undefined,
  areaId: values.areaId || null,
  interestedProjectIds: values.interestedProjectIds,
  statusId: values.statusId || undefined,
  sourceId: values.sourceId || null,
});
