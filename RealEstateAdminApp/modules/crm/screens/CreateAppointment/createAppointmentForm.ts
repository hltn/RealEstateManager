/**
 * Hàm thuần của form "Tạo lịch hẹn mới": giá trị mặc định, danh mục lựa chọn, validate, dựng input cho store.
 * Không phụ thuộc React -> dùng chung cho biến thể desktop + mobile.
 */
import { PROJECTS, STAFF_LIST } from '@crm/data/mockData';
import { getInitials, isSameStaffName } from '@crm/lib/staff';
import { parseTime24 } from '@crm/lib/dateTime';
import type { NewAppointmentInput } from '@crm/store';
import type { AppointmentType, Customer, Project, StaffMember } from '@crm/types/crm';

export const DETAILS_MAX_LENGTH = 500;
export const DEFAULT_TIME = '09:30';
export const DEFAULT_REMINDER = 'Trước 1 tiếng (Khuyến nghị)';
export const REMINDER_OPTIONS = ['Trước 15 phút', 'Trước 30 phút', DEFAULT_REMINDER, 'Trước 2 tiếng', 'Trước 1 ngày'] as const;
/** Địa điểm gợi ý cho lịch "Nhắc gọi" (không gặp mặt) - theo dữ liệu mẫu APT-003. */
export const CALL_LOCATION = 'Cuộc gọi điện thoại & Zalo';

export interface AppointmentFormValues {
  customerId: string;
  projectName: string;
  type: AppointmentType;
  /** ISO "YYYY-MM-DD" (DatePicker flatpickr `Y-m-d`). */
  date: string;
  /** "HH:mm" (input type=time). */
  time: string;
  location: string;
  details: string;
  leadStaffId: string;
  /** '' = không có người hỗ trợ. */
  supportStaffId: string;
  reminderBefore: string;
  smsZnsAuto: boolean;
  calendarSync: boolean;
}

export type AppointmentFormField = keyof AppointmentFormValues;
export type AppointmentFormErrors = Partial<Record<AppointmentFormField, string>>;

/** Thứ tự trường để focus lỗi đầu tiên (khớp thứ tự hiển thị). */
export const FIELD_ORDER: AppointmentFormField[] = ['customerId', 'projectName', 'type', 'date', 'time', 'location', 'details', 'leadStaffId'];

/** id DOM của ô nhập ứng với trường (dùng cho `htmlFor` + focus lỗi). */
export const getFieldId = (field: AppointmentFormField): string => `appointment-${field}`;

export interface AppointmentTypeOption {
  type: AppointmentType;
  title: string;
  description: string;
  /** Nhãn gọn cho mobile (lưới 2 cột hẹp). */
  shortTitle: string;
  shortDescription: string;
  isHighPriority?: boolean;
}

/** Nội dung thẻ chọn loại: tiêu đề/mô tả của Admin Stitch, nhãn gọn của Mobile Stitch. */
export const APPOINTMENT_TYPE_OPTIONS: AppointmentTypeOption[] = [
  {
    type: 'xem_nha',
    title: 'Xem nhà mẫu / Trải nghiệm thực tế',
    description: 'Dẫn khách thăm quan sa bàn, căn hộ mẫu thực tế và tiện ích nội khu dự án.',
    shortTitle: 'Xem nhà mẫu',
    shortDescription: 'Trải nghiệm dự án',
  },
  {
    type: 'ky_coc',
    title: 'Ký cọc / Ký hợp đồng mua bán',
    description: 'Thủ tục đặt cọc thiện chí, ký văn bản thỏa thuận hoặc HĐMB trực tiếp với CĐT.',
    shortTitle: 'Ký cọc / HĐ',
    shortDescription: 'Ưu tiên cao',
    isHighPriority: true,
  },
  {
    type: 'gap_truc_tiep',
    title: 'Gặp tư vấn trực tiếp / Pháp lý',
    description: 'Phân tích tiến độ dòng tiền, bảng so sánh lợi nhuận và thủ tục ngân hàng hỗ trợ.',
    shortTitle: 'Gặp tư vấn',
    shortDescription: 'Trao đổi chính sách',
  },
  {
    type: 'nhac_goi',
    title: 'Nhắc gọi điện / Telesale chốt deal',
    description: 'Nhắc nhở cuộc gọi theo hẹn trước để cập nhật rổ hàng mới hoặc giữ chỗ ưu tiên.',
    shortTitle: 'Nhắc gọi điện',
    shortDescription: 'Telesale / Chốt deal',
  },
  {
    type: 'khac',
    title: 'Mục đích khác',
    description: 'Ghi rõ chi tiết ở phần nội dung trao đổi bên dưới.',
    shortTitle: 'Mục đích khác',
    shortDescription: 'Ghi rõ ở phần ghi chú',
  },
];

export const STAFF_OPTIONS: StaffMember[] = STAFF_LIST;


export const findProject = (projectName: string): Project | undefined => PROJECTS.find((project) => project.name === projectName);

/** Dự án mặc định theo khách: dự án quan tâm đầu tiên có trong danh mục, nếu không thì dự án đầu danh mục. */
export const getDefaultProjectName = (customer: Customer | null): string =>
  customer?.interestedProjects.find((projectName) => findProject(projectName))?.trim() ?? PROJECTS[0]?.name ?? '';

/** Người phụ trách mặc định = nhân viên trùng `customer.staffLead`, nếu không có lấy người đầu danh sách. */
export const getDefaultLeadStaffId = (customer: Customer | null): string => {
  const matched = STAFF_OPTIONS.find(
    (staff) => customer && isSameStaffName(staff.name, customer.staffLead),
  );
  return matched?.id ?? STAFF_OPTIONS[0]?.id ?? '';
};

export const createInitialValues = (customer: Customer | null, todayIso: string): AppointmentFormValues => ({
  customerId: customer?.id ?? '',
  projectName: getDefaultProjectName(customer),
  type: 'xem_nha',
  date: todayIso,
  time: DEFAULT_TIME,
  location: '',
  details: '',
  leadStaffId: getDefaultLeadStaffId(customer),
  supportStaffId: '',
  reminderBefore: DEFAULT_REMINDER,
  smsZnsAuto: true,
  calendarSync: true,
});

/** Địa chỉ gợi ý từ dự án (nút "Dùng văn phòng dự án"). */
export const getProjectOfficeLocation = (projectName: string): string => {
  const project = findProject(projectName);
  return project ? `Văn phòng bán hàng ${project.fullName}, ${project.location}` : '';
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validate trường bắt buộc + định dạng. Trả object rỗng nếu hợp lệ. */
export const validateAppointmentForm = (values: AppointmentFormValues, customers: Customer[]): AppointmentFormErrors => {
  const errors: AppointmentFormErrors = {};
  if (!values.customerId || !customers.some((customer) => customer.id === values.customerId)) {
    errors.customerId = 'Vui lòng chọn khách hàng.';
  }
  if (!values.projectName.trim()) errors.projectName = 'Vui lòng chọn dự án liên quan.';
  if (!ISO_DATE_PATTERN.test(values.date)) errors.date = 'Vui lòng chọn ngày diễn ra.';
  if (!parseTime24(values.time)) errors.time = 'Vui lòng nhập giờ hợp lệ (HH:mm).';
  if (!values.location.trim()) errors.location = 'Vui lòng nhập địa điểm gặp mặt.';
  if (values.details.length > DETAILS_MAX_LENGTH) {
    errors.details = `Nội dung tối đa ${DETAILS_MAX_LENGTH} ký tự.`;
  } else if (values.type === 'khac' && !values.details.trim()) {
    errors.details = 'Mục đích khác: vui lòng ghi rõ nội dung buổi hẹn.';
  }
  if (!STAFF_OPTIONS.some((staff) => staff.id === values.leadStaffId)) errors.leadStaffId = 'Vui lòng chọn người phụ trách.';
  return errors;
};

/** Giá trị form hợp lệ -> input của `addAppointment` (snapshot khách do store tự lấy). */
export const toNewAppointmentInput = (values: AppointmentFormValues): NewAppointmentInput => {
  const leadStaff = STAFF_OPTIONS.find((staff) => staff.id === values.leadStaffId);
  const supportStaff = STAFF_OPTIONS.find((staff) => staff.id === values.supportStaffId);
  const leadStaffName = leadStaff?.name ?? '';
  return {
    customerId: values.customerId,
    projectName: values.projectName,
    type: values.type,
    date: values.date,
    time: values.time,
    location: values.location.trim(),
    details: values.details.trim(),
    leadStaffName,
    leadStaffInitials: getInitials(leadStaffName),
    supportStaff: supportStaff?.name,
    reminderBefore: values.reminderBefore,
    smsZnsAuto: values.smsZnsAuto,
    calendarSync: values.calendarSync,
  };
};

/** "2026-10-21" -> "Thứ Tư, 21 tháng 10, 2026" (dòng gợi ý dưới ô ngày). */
export const formatLongDateVi = (isoDate: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const text = date.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
