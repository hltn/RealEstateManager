/**
 * Mô hình form "Cập nhật Chân dung khách hàng" (C10/C11) dùng chung cho 2 biến thể.
 * Giá trị theo dạng chuẩn `Customer` (nhãn Admin); biến thể Mobile đổi mã qua adapter khi hiển thị.
 */
import { stripHashtag } from '@crm/lib/customerAdapters';
import type { CustomerChanges } from '@crm/store';
import type { ContactMethod, Customer, DecisionMaker } from '@crm/types/crm';
import {
  formatVnPhone,
  getPhoneError,
  isValidBirthDate,
  isValidIdNumber,
  isValidOptionalEmail,
  type FormErrors,
} from '../CreateCustomer/customerFormRules';

export interface PersonaFormValues {
  name: string;
  phone: string;
  email: string;
  idNumber: string;
  birthDate: string;
  remindBirthday: boolean;
  hometown: string;
  maritalStatus: string;
  children: string;
  occupation: string;
  businessField: string;
  decisionMaker: DecisionMaker;
  /** Không có dấu '#'. */
  lifestyleTags: string[];
  isVip: boolean;
  preferredContactMethod: ContactMethod;
  freeTimeSlot: string;
  preferredSalutation: string;
  notes: string;
}

export type PersonaField = keyof PersonaFormValues;

export const PERSONA_FIELD_ORDER: readonly PersonaField[] = [
  'name',
  'phone',
  'email',
  'idNumber',
  'birthDate',
  'occupation',
];

export const MARITAL_STATUS_OPTIONS = ['Đã kết hôn', 'Độc thân', 'Ly hôn / Khác'] as const;

/** Gợi ý sở thích phổ biến (gộp 2 nguồn, lưu không có '#'). */
export const LIFESTYLE_TAG_SUGGESTIONS: readonly string[] = [
  'Du lịch nghỉ dưỡng',
  'Nuôi thú cưng',
  'Xe sang',
  'Đầu tư dài hạn',
  'Nhà thông minh',
];

const DMY_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "15/03/1985" -> "1985-03-15" cho DatePicker (flatpickr `Y-m-d`); chuỗi lạ -> ''. */
export const birthDateToIso = (birthDate: string): string => {
  const match = DMY_PATTERN.exec(birthDate.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};

/** "1985-03-15" -> "15/03/1985" (định dạng lưu của dữ liệu CRM); chuỗi lạ giữ nguyên. */
export const isoToBirthDate = (isoDate: string): string => {
  const match = ISO_PATTERN.exec(isoDate.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
};

export const toPersonaFormValues = (customer: Customer): PersonaFormValues => ({
  name: customer.name,
  phone: customer.phone,
  email: customer.email,
  idNumber: customer.idNumber,
  birthDate: customer.birthDate,
  // Cả 2 nguồn mặc định bật nhắc sinh nhật khi khách chưa có thiết lập.
  remindBirthday: customer.remindBirthday ?? true,
  hometown: customer.hometown,
  maritalStatus: customer.maritalStatus,
  children: customer.children,
  occupation: customer.occupation,
  businessField: customer.businessField,
  decisionMaker: customer.decisionMaker,
  lifestyleTags: customer.lifestyleTags.map(stripHashtag).filter(Boolean),
  isVip: customer.isVip,
  preferredContactMethod: customer.preferredContactMethod,
  freeTimeSlot: customer.freeTimeSlot,
  preferredSalutation: customer.preferredSalutation,
  notes: customer.notes,
});

/** Kiểm tra form chân dung; SĐT không được trùng khách KHÁC. */
export const validatePersona = (
  values: PersonaFormValues,
  customers: readonly Customer[],
  customerId: string,
): FormErrors<PersonaField> => {
  const errors: FormErrors<PersonaField> = {};
  if (!values.name.trim()) errors.name = 'Vui lòng nhập họ và tên khách hàng.';
  const phoneError = getPhoneError(values.phone, customers, customerId);
  if (phoneError) errors.phone = phoneError;
  if (!isValidOptionalEmail(values.email)) errors.email = 'Email không hợp lệ (VD: khachhang@stnd.vn).';
  if (!isValidIdNumber(values.idNumber)) errors.idNumber = 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).';
  if (!values.birthDate.trim()) errors.birthDate = 'Vui lòng nhập ngày sinh (dd/mm/yyyy).';
  else if (!isValidBirthDate(values.birthDate)) errors.birthDate = 'Ngày sinh không hợp lệ (định dạng dd/mm/yyyy).';
  if (!values.occupation.trim()) errors.occupation = 'Vui lòng nhập nghề nghiệp / chức vụ.';
  return errors;
};

/** "#Golf " -> thêm "Golf" nếu chưa có (so sánh không phân biệt hoa thường). */
export const addLifestyleTag = (tags: readonly string[], rawTag: string): string[] => {
  const tag = stripHashtag(rawTag);
  if (!tag || tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return [...tags];
  return [...tags, tag];
};

/** Chuyển form hợp lệ thành thay đổi cho `updateCustomer` (trim, chuẩn hoá SĐT, hạng VIP). */
export const toPersonaChanges = (values: PersonaFormValues, customer: Pick<Customer, 'vipTier'>): CustomerChanges => ({
  name: values.name.trim(),
  phone: formatVnPhone(values.phone),
  email: values.email.trim(),
  idNumber: values.idNumber.trim(),
  birthDate: values.birthDate.trim(),
  remindBirthday: values.remindBirthday,
  hometown: values.hometown.trim(),
  maritalStatus: values.maritalStatus,
  children: values.children.trim(),
  occupation: values.occupation.trim(),
  businessField: values.businessField.trim(),
  decisionMaker: values.decisionMaker,
  lifestyleTags: [...values.lifestyleTags],
  isVip: values.isVip,
  vipTier: values.isVip ? (customer.vipTier ?? 'VIP') : undefined,
  preferredContactMethod: values.preferredContactMethod,
  freeTimeSlot: values.freeTimeSlot.trim(),
  preferredSalutation: values.preferredSalutation.trim(),
  notes: values.notes,
});
