/**
 * Mô hình form "Thêm khách hàng mới" dùng chung desktop + mobile.
 * Giá trị mặc định RỖNG (không điền sẵn dữ liệu mẫu); tình trạng mặc định lấy từ danh mục (`isDefault` = "Chưa tiếp cận").
 * Phụ trách chính mặc định = người tạo (04 §6.1); nhân viên luôn là phụ trách chính khi tự tạo khách.
 */
import type { CreateCustomerInput } from '@crm/api';
import type { UserRole } from '@crm/types/crm';
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
  /** '' = chưa phân (chỉ Quản lý/Quản trị được để trống). */
  primaryUserId: string;
  memberIds: string[];
}

export type CreateCustomerField = keyof CreateCustomerFormValues;

/** Thứ tự kiểm tra (= thứ tự hiển thị trên form) để toast báo lỗi đầu tiên. */
export const CREATE_CUSTOMER_FIELD_ORDER: readonly CreateCustomerField[] = ['fullName', 'phone', 'email', 'nationalId', 'primaryUserId'];

export const createDefaultFormValues = (defaults: { statusId: string; currentUserId: string }): CreateCustomerFormValues => ({
  fullName: '',
  phone: '',
  email: '',
  nationalId: '',
  areaId: '',
  interestedProjectIds: [],
  statusId: defaults.statusId,
  sourceId: '',
  primaryUserId: defaults.currentUserId,
  memberIds: [],
});

/** Kiểm tra form (chỉ họ tên + SĐT bắt buộc). Trùng SĐT kiểm riêng qua `lookupPhone`. */
export const validateCreateCustomer = (values: CreateCustomerFormValues): FormErrors<CreateCustomerField> => {
  const errors: FormErrors<CreateCustomerField> = {};
  const fullNameError = getFullNameError(values.fullName);
  if (fullNameError) errors.fullName = fullNameError;
  const phoneError = getPhoneFormatError(values.phone);
  if (phoneError) errors.phone = phoneError;
  if (!isValidOptionalEmail(values.email)) errors.email = 'Email không hợp lệ (VD: khachhang@stnd.vn).';
  if (!isValidNationalId(values.nationalId)) errors.nationalId = 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).';
  if (!values.primaryUserId && values.memberIds.length > 0) errors.primaryUserId = 'Chọn người phụ trách chính khi có người cùng chăm sóc.';
  return errors;
};

/**
 * Form hợp lệ -> body `POST /crm/customers`. Nhân viên KHÔNG gửi `careTeam` (server tự đặt người tạo làm phụ trách chính;
 * gửi `careTeam` sẽ bị 403 `CARE_TEAM_ACTION_FORBIDDEN`).
 */
export const toCreateCustomerInput = (values: CreateCustomerFormValues, role: UserRole): CreateCustomerInput => ({
  fullName: values.fullName.trim(),
  phone: values.phone,
  email: values.email.trim(),
  nationalId: values.nationalId.trim() || undefined,
  areaId: values.areaId || null,
  interestedProjectIds: values.interestedProjectIds,
  statusId: values.statusId || undefined,
  sourceId: values.sourceId || null,
  careTeam: role !== 'STAFF' && values.primaryUserId ? { primaryUserId: values.primaryUserId, memberIds: values.memberIds } : undefined,
});
