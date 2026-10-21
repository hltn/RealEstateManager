/**
 * Mô hình form "Thêm khách hàng mới" dùng chung cho 2 biến thể (Admin + Mobile).
 * - Giá trị lưu theo dạng chuẩn `Customer` (ngân sách = số tỷ, trạng thái = nhãn Admin).
 * - Mobile nhập ngân sách dạng chữ ("3 tỷ") -> chuyển bằng `parseBudget` trước khi đưa vào đây.
 */
import { CURRENT_USER, STAFF_LIST } from '@crm/data/mockData';
import { createEmptyC4Criteria, createEmptyCustomer } from '@crm/lib/customerFactory';
import type { NewCustomerInput } from '@crm/store';
import type { Customer, CustomerStatus } from '@crm/types/crm';
import {
  formatVnPhone,
  getPhoneError,
  isValidIdNumber,
  isValidOptionalEmail,
  type FormErrors,
} from './customerFormRules';

export interface CreateCustomerFormValues {
  name: string;
  phone: string;
  email: string;
  idNumber: string;
  currentResidence: string;
  interestedProjects: string[];
  status: CustomerStatus;
  leadSource: string;
  /** Tỷ VNĐ. */
  budgetMin: number;
  /** Tỷ VNĐ. */
  budgetMax: number;
  staffLead: string;
  /** Chuỗi rỗng = không chọn cộng sự. */
  staffSupport: string;
}

export type CreateCustomerField = keyof CreateCustomerFormValues;

/** Thứ tự kiểm tra (= thứ tự hiển thị trên form) để toast báo lỗi đầu tiên. */
export const CREATE_CUSTOMER_FIELD_ORDER: readonly CreateCustomerField[] = [
  'name',
  'phone',
  'email',
  'idNumber',
  'budgetMin',
  'budgetMax',
  'staffLead',
];

/** 3 trạng thái ban đầu cho phép chọn khi tạo khách (giống cả 2 nguồn). */
export const INITIAL_STATUS_OPTIONS: readonly CustomerStatus[] = ['Chưa tiếp cận', 'Có quan tâm', 'Khách net'];

/** Dự án gợi ý ở form tạo khách. Nguồn ghi "Q'Terra Diamond" -> dùng tên chuẩn "Q'Terra" trong PROJECTS. */
export const CREATE_FORM_PROJECTS: readonly string[] = [
  "Q'Terra",
  'The Privia',
  'Ecopark Grand',
  'Aqua City Waterfront',
  'Vinhomes Grand Park',
];

export interface StaffOption {
  /** Giá trị lưu vào `staffLead` / `staffSupport` (họ tên đầy đủ trong `STAFF_LIST`). */
  value: string;
  label: string;
}

/** Khu vực nơi ở (gộp 2 nguồn). */
export const RESIDENCE_OPTIONS: readonly string[] = [
  'Quận 7, TP.HCM',
  'Thành phố Thủ Đức, TP.HCM',
  'Quận 1, TP.HCM',
  'Quận Bình Thạnh, TP.HCM',
  'Huyện Nhà Bè, TP.HCM',
  'Hà Nội (Khu vực phía Tây)',
];

/** Nguồn khách (gộp 2 nguồn, dùng chung với form Thông tin đầu tư). */
export const LEAD_SOURCE_OPTIONS: readonly string[] = [
  'Website STND',
  'Facebook Ads',
  'Google Search Ads',
  'Giới thiệu từ khách VIP cũ',
  'Telesales data nội bộ',
  'Sự kiện mở bán đợt 1',
];

/**
 * Nhân sự phụ trách lấy từ STAFF_LIST (1 danh sách cho cả desktop + mobile; 2 nguồn Stitch mỗi bản 1 danh sách khác nhau).
 * Giá trị = họ tên đầy đủ (cùng dạng `staffLead` của dữ liệu mẫu), nhãn kèm vai trò.
 */
export const STAFF_OPTIONS: readonly StaffOption[] = STAFF_LIST.map((staff) => ({
  value: staff.name,
  label: `${staff.name} — ${staff.role}`,
}));

export const createDefaultFormValues = (): CreateCustomerFormValues => ({
  name: '',
  phone: '',
  email: '',
  idNumber: '',
  currentResidence: 'Quận 7, TP.HCM',
  interestedProjects: ["Q'Terra", 'The Privia'],
  status: 'Có quan tâm',
  leadSource: 'Website STND',
  budgetMin: 3,
  budgetMax: 5,
  staffLead: CURRENT_USER.fullName,
  staffSupport: '',
});

/** Kiểm tra toàn bộ form. `customers` dùng để đối soát trùng SĐT. */
export const validateCreateCustomer = (
  values: CreateCustomerFormValues,
  customers: readonly Customer[],
): FormErrors<CreateCustomerField> => {
  const errors: FormErrors<CreateCustomerField> = {};
  if (!values.name.trim()) errors.name = 'Vui lòng nhập họ và tên khách hàng.';
  const phoneError = getPhoneError(values.phone, customers);
  if (phoneError) errors.phone = phoneError;
  if (!isValidOptionalEmail(values.email)) errors.email = 'Email không hợp lệ (VD: khachhang@stnd.vn).';
  if (!isValidIdNumber(values.idNumber)) errors.idNumber = 'Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).';
  if (!Number.isFinite(values.budgetMin) || values.budgetMin < 0) errors.budgetMin = 'Ngân sách không hợp lệ.';
  if (!Number.isFinite(values.budgetMax) || values.budgetMax < 0) errors.budgetMax = 'Ngân sách không hợp lệ.';
  else if (values.budgetMax > 0 && values.budgetMin > values.budgetMax) {
    errors.budgetMax = 'Ngân sách tối đa phải lớn hơn hoặc bằng mức tối thiểu.';
  }
  if (!values.staffLead.trim()) errors.staffLead = 'Vui lòng chọn nhân viên phụ trách chính.';
  return errors;
};

/** "Nguyễn Văn An" -> "Anh/Chị An" (danh xưng mặc định như bản Admin). */
export const getDefaultSalutation = (name: string): string => {
  const givenName = name.trim().split(/\s+/).pop() ?? '';
  return givenName ? `Anh/Chị ${givenName}` : '';
};

/**
 * Dựng input cho `addCustomer` từ form đã hợp lệ.
 * Các trường form không có được để mặc định rỗng (không bịa dữ liệu như prototype),
 * trừ những giá trị suy ra được: VIP theo trạng thái, danh xưng, khu vực tìm kiếm, tóm tắt ghi chú.
 */
export const buildNewCustomerInput = (values: CreateCustomerFormValues): NewCustomerInput => {
  const isHotLead = values.status === 'Khách net';
  const primaryProject = values.interestedProjects[0];
  const c4Criteria = createEmptyC4Criteria();
  if (primaryProject) {
    c4Criteria.demand = { ...c4Criteria.demand, achieved: true, text: `Quan tâm căn hộ tại ${primaryProject}.` };
  }

  // createEmptyCustomer cần id -> tạo bản nháp rồi bỏ id/code để store tự sinh.
  const { id: _draftId, code: _draftCode, ...draft } = createEmptyCustomer({
    id: 'draft',
    name: values.name.trim(),
    phone: formatVnPhone(values.phone),
    email: values.email.trim(),
    idNumber: values.idNumber.trim(),
    isVip: isHotLead,
    vipTier: isHotLead ? 'VIP' : undefined,
    status: values.status,
    progressPercentage: 25,
    progressStep: 'Mới tiếp nhận hồ sơ',
    currentResidence: values.currentResidence,
    preferredSalutation: getDefaultSalutation(values.name),
    staffLead: values.staffLead,
    staffSupport: values.staffSupport ? [values.staffSupport] : [],
    teamGroup: CURRENT_USER.team,
    interestedProjects: [...values.interestedProjects],
    budgetMin: values.budgetMin,
    budgetMax: values.budgetMax,
    searchArea: values.currentResidence,
    leadSource: values.leadSource,
    notes: 'Khách hàng mới tiếp nhận từ hệ thống.',
    notesSummary: `Tiếp nhận từ kênh ${values.leadSource}${
      values.interestedProjects.length > 0 ? `, quan tâm dự án ${values.interestedProjects.join(', ')}` : ''
    }.`,
    c4Criteria,
  });
  return draft;
};
