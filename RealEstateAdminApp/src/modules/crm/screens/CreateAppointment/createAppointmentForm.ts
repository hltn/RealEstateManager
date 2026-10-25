/**
 * Hàm thuần của form "Tạo lịch hẹn mới": giá trị mặc định, danh mục lựa chọn, validate, dựng body `POST /crm/appointments`.
 * Ngày + giờ nhập theo giờ Việt Nam, lưu `startAt` ISO UTC. Người thực hiện phải thuộc nhóm chăm sóc của khách.
 */
import type { CreateAppointmentInput, CustomerDetail } from '@crm/api';
import { getVnTodayKey, parseTime24, vnDateTimeToIso } from '@crm/lib/dateTime';
import type { AppointmentType, Project } from '@crm/types/crm';

export const NOTE_MAX_LENGTH = 500;
export const DEFAULT_TIME = '09:30';
export const DEFAULT_REMINDER_MINUTES = 60;
/** Địa điểm gợi ý cho lịch "Nhắc gọi lại" (không gặp mặt). */
export const CALL_LOCATION = 'Gọi điện / Zalo';

export interface AppointmentFormValues {
  customerId: string;
  type: AppointmentType;
  title: string;
  /** Khoá ngày VN "YYYY-MM-DD". */
  date: string;
  /** "HH:mm" giờ VN. */
  time: string;
  location: string;
  note: string;
  assigneeId: string;
  remindBeforeMinutes: number;
  smsZnsAuto: boolean;
  calendarSync: boolean;
}

export type AppointmentFormField = keyof AppointmentFormValues;
export type AppointmentFormErrors = Partial<Record<AppointmentFormField, string>>;

/** Thứ tự trường để focus lỗi đầu tiên (khớp thứ tự hiển thị). */
export const FIELD_ORDER: AppointmentFormField[] = ['customerId', 'type', 'date', 'time', 'location', 'note', 'assigneeId'];

/** id DOM của ô nhập ứng với trường (dùng cho `htmlFor` + focus lỗi). */
export const getFieldId = (field: AppointmentFormField): string => `appointment-${field}`;

export interface AppointmentTypeOption {
  type: AppointmentType;
  title: string;
  description: string;
  shortTitle: string;
  shortDescription: string;
  isHighPriority?: boolean;
}

export const APPOINTMENT_TYPE_OPTIONS: AppointmentTypeOption[] = [
  { type: 'SITE_VISIT', title: 'Xem nhà mẫu / sa bàn', description: 'Dẫn khách xem sa bàn, căn hộ mẫu và tiện ích dự án.', shortTitle: 'Xem nhà mẫu', shortDescription: 'Trải nghiệm dự án' },
  { type: 'DEPOSIT_CONTRACT', title: 'Ký cọc / HĐMB', description: 'Hẹn ký thỏa thuận đặt cọc hoặc hợp đồng mua bán.', shortTitle: 'Ký cọc / HĐMB', shortDescription: 'Ưu tiên cao', isHighPriority: true },
  { type: 'MEETING', title: 'Gặp tư vấn', description: 'Trao đổi phương án tài chính, pháp lý, chính sách bán hàng.', shortTitle: 'Gặp tư vấn', shortDescription: 'Trao đổi trực tiếp' },
  { type: 'CALLBACK', title: 'Nhắc gọi lại', description: 'Nhắc gọi lại cho khách theo hẹn.', shortTitle: 'Nhắc gọi lại', shortDescription: 'Gọi lại theo hẹn' },
  { type: 'OTHER', title: 'Mục đích khác', description: 'Ghi rõ nội dung ở phần ghi chú bên dưới.', shortTitle: 'Mục đích khác', shortDescription: 'Ghi rõ ở ghi chú' },
];

/** Người thực hiện mặc định: mình nếu thuộc nhóm chăm sóc, không thì phụ trách chính, cuối cùng là mình. */
export const getDefaultAssigneeId = (customer: CustomerDetail | null, currentUserId: string): string => {
  if (!customer || customer.careTeam.length === 0) return currentUserId;
  if (customer.careTeam.some((member) => member.user.id === currentUserId)) return currentUserId;
  return customer.primaryAssignee?.id ?? currentUserId;
};

export const createInitialValues = (customer: CustomerDetail | null, todayKey: string, currentUserId: string): AppointmentFormValues => ({
  customerId: customer?.id ?? '',
  type: 'SITE_VISIT',
  title: '',
  date: todayKey,
  time: DEFAULT_TIME,
  location: '',
  note: '',
  assigneeId: getDefaultAssigneeId(customer, currentUserId),
  remindBeforeMinutes: DEFAULT_REMINDER_MINUTES,
  smsZnsAuto: false,
  calendarSync: false,
});

/** Địa chỉ gợi ý: văn phòng của dự án khách quan tâm đầu tiên (nút "Dùng văn phòng dự án"). */
export const getProjectOfficeLocation = (project: Project | undefined): string =>
  project ? `Văn phòng bán hàng ${project.fullName}, ${project.location}` : '';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validate trường bắt buộc + định dạng. Trả object rỗng nếu hợp lệ. */
/** Dung sai giờ hẹn ở quá khứ (backend chấp nhận lệch ≤ 5 phút so với hiện tại). */
export const PAST_TOLERANCE_MS = 5 * 60 * 1000;

export const validateAppointmentForm = (values: AppointmentFormValues, customer: CustomerDetail | null, todayKey: string = getVnTodayKey(), now: Date = new Date()): AppointmentFormErrors => {
  const errors: AppointmentFormErrors = {};
  if (!values.customerId || !customer) errors.customerId = 'Vui lòng chọn khách hàng.';
  if (!DATE_KEY_PATTERN.test(values.date)) errors.date = 'Vui lòng chọn ngày diễn ra.';
  else if (values.date < todayKey) errors.date = 'Ngày hẹn không được ở quá khứ.';
  if (!parseTime24(values.time)) errors.time = 'Vui lòng nhập giờ hợp lệ (HH:mm).';
  else if (!errors.date && new Date(vnDateTimeToIso(values.date, values.time)).getTime() < now.getTime() - PAST_TOLERANCE_MS) errors.time = 'Giờ hẹn không được ở quá khứ.';
  if (values.type !== 'CALLBACK' && !values.location.trim()) errors.location = 'Vui lòng nhập địa điểm gặp.';
  if (values.note.length > NOTE_MAX_LENGTH) errors.note = `Ghi chú tối đa ${NOTE_MAX_LENGTH} ký tự.`;
  else if (values.type === 'OTHER' && !values.note.trim()) errors.note = 'Mục đích khác: vui lòng ghi rõ nội dung buổi hẹn.';
  if (customer && customer.careTeam.length > 0 && !customer.careTeam.some((member) => member.user.id === values.assigneeId)) {
    errors.assigneeId = 'Người thực hiện phải thuộc nhóm chăm sóc của khách.';
  }
  return errors;
};

/** Giá trị form hợp lệ -> body `POST /crm/appointments` (giờ VN -> ISO UTC). */
export const toCreateAppointmentInput = (values: AppointmentFormValues): CreateAppointmentInput => ({
  customerId: values.customerId,
  type: values.type,
  title: values.title.trim(),
  startAt: vnDateTimeToIso(values.date, values.time),
  location: values.location.trim(),
  note: values.note.trim(),
  assigneeId: values.assigneeId || undefined,
  remindBeforeMinutes: [values.remindBeforeMinutes],
});

/** "2026-10-21" -> "Thứ Tư, 21 tháng 10, 2026" (dòng gợi ý dưới ô ngày). */
export const formatLongDateVi = (dateKey: string): string => {
  if (!DATE_KEY_PATTERN.test(dateKey)) return '';
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  const text = date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
