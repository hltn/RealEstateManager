import type { Appointment, AppointmentType, Customer, DailyTask, DayPeriod } from '@crm/types/crm';
import { getDayPeriod } from './dateTime';

/** Nhãn loại lịch hẹn (= `purpose` của Admin, đầy đủ hơn nhãn Mobile). */
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  xem_nha: 'Xem nhà mẫu',
  ky_coc: 'Ký cọc / Hợp đồng',
  gap_truc_tiep: 'Gặp tư vấn / Pháp lý',
  nhac_goi: 'Nhắc gọi tư vấn',
  khac: 'Khác',
};

/** Buổi sáng/chiều của lịch hẹn (Mobile `period`). */
export const getAppointmentPeriod = (appointment: Pick<Appointment, 'time'>): DayPeriod =>
  getDayPeriod(appointment.time);

/** Tiêu đề hiển thị: ưu tiên `title`, nếu trống -> "09:30 - Xem nhà mẫu". */
export const getAppointmentTitle = (appointment: Pick<Appointment, 'title' | 'time' | 'type'>): string =>
  appointment.title?.trim() || `${appointment.time} - ${APPOINTMENT_TYPE_LABELS[appointment.type]}`;

/** Snapshot thông tin khách vào lịch hẹn để tránh lệch tên/SĐT. */
export const getAppointmentCustomerSnapshot = (
  customer: Customer,
): Pick<Appointment, 'customerId' | 'customerName' | 'customerPhone' | 'customerTag'> => ({
  customerId: customer.id,
  customerName: customer.name,
  customerPhone: customer.phone,
  customerTag: customer.status,
});

/** Mô tả tự động gắn vào việc sinh từ lịch hẹn (theo Admin handleAddAppointment). */
export const APPOINTMENT_TASK_AI_SUGGESTION = 'Đã thiết lập gửi thiệp Zalo ZNS và nhắc hẹn tự động.';

/**
 * Sinh DailyTask "hôm nay" từ lịch hẹn mới tạo (luồng của bản Admin).
 * `statusTag` lấy theo trạng thái thật của khách nếu tìm thấy.
 */
export const createTaskFromAppointment = (
  appointment: Appointment,
  taskId: string,
  customer?: Customer,
): DailyTask => ({
  id: taskId,
  customerId: appointment.customerId,
  customerName: appointment.customerName,
  customerPhone: appointment.customerPhone,
  statusTag: customer?.status ?? 'Có quan tâm',
  projectName: appointment.projectName,
  category: 'today',
  timeText: appointment.time,
  content: `${APPOINTMENT_TYPE_LABELS[appointment.type]}: ${appointment.details}`,
  aiSuggestion: APPOINTMENT_TASK_AI_SUGGESTION,
  assignee: appointment.leadStaffName,
  appointmentId: appointment.id,
});
