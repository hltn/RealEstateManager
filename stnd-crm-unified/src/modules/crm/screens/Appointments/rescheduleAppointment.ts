/**
 * Hàm thuần cho "Đổi giờ" lịch hẹn: dựng body `PATCH /crm/appointments/:id` từ ngày + giờ VN mới.
 * Lịch có giờ kết thúc thì dời theo cùng khoảng thời lượng (backend từ chối `endAt` không sau `startAt`).
 */
import type { AppointmentView } from '@crm/api';
import { vnDateTimeToIso } from '@crm/lib/dateTime';

export interface RescheduleBody {
  version: number;
  startAt: string;
  endAt?: string;
}

export const buildRescheduleBody = (appointment: Pick<AppointmentView, 'version' | 'startAt' | 'endAt'>, date: string, time: string): RescheduleBody => {
  const startAt = vnDateTimeToIso(date, time);
  const body: RescheduleBody = { version: appointment.version, startAt };
  if (appointment.endAt) {
    const durationMs = new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime();
    body.endAt = new Date(new Date(startAt).getTime() + durationMs).toISOString();
  }
  return body;
};
