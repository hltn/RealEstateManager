import { useAppointments, type AppointmentView, type QueryState } from '@crm/api';
import { addDaysToDateKey } from '@crm/lib/dateTime';

/** Nửa cửa sổ (ngày) quanh ngày đang xem; tổng 60 ngày ≤ giới hạn 62 ngày của `GET /crm/appointments` (05 §2.9). */
export const APPOINTMENT_WINDOW_HALF_DAYS = 30;

/** Khoảng ngày VN `[from, to]` cho lịch hiển thị quanh `selectedDate`. */
export const getAppointmentWindowAround = (selectedDate: string): { from: string; to: string } => ({
  from: addDaysToDateKey(selectedDate, -APPOINTMENT_WINDOW_HALF_DAYS),
  to: addDaysToDateKey(selectedDate, APPOINTMENT_WINDOW_HALF_DAYS),
});

/** Lịch hẹn trong cửa sổ quanh ngày đang chọn (đổi tuần/tháng thì tải cửa sổ mới, giữ dữ liệu cũ trong lúc tải). */
export const useAppointmentsAround = (selectedDate: string): QueryState<AppointmentView[]> => useAppointments(getAppointmentWindowAround(selectedDate));
