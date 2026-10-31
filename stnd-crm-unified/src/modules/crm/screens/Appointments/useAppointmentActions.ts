/**
 * Thao tác lịch hẹn dùng chung thẻ desktop/mobile/menu: đánh dấu hoàn thành / mở lại
 * (`PATCH /crm/appointments/:id/status`, gửi `version` khóa lạc quan) + toast tiếng Việt.
 * Đổi giờ (`PATCH /crm/appointments/:id`) và hủy lịch (`PATCH .../status` = CANCELED, có "Hoàn tác" mở lại) cũng gửi `version`:
 * lịch đã bị người khác đổi thì báo xung đột (dữ liệu được tải lại), không ghi đè.
 * Chống bấm đúp: bỏ qua lần bấm khi thao tác trước cho cùng lịch chưa xong.
 */
import { useMemo, useRef } from 'react';
import { APPOINTMENT_VERSION_CONFLICT_GUIDE, describeWriteError, useCrmApi, type AppointmentView } from '@crm/api';
import { useCrmActions } from '@crm/store';
import { buildRescheduleBody } from './rescheduleAppointment';

const UNDO_DURATION_MS = 10_000;

/** Lỗi ghi lịch hẹn; xung đột phiên bản nói đúng "Lịch hẹn" (không phải "Hồ sơ"). */
const describeAppointmentError = (error: Parameters<typeof describeWriteError>[0]): string => describeWriteError(error, APPOINTMENT_VERSION_CONFLICT_GUIDE);

export const useAppointmentActions = () => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const pendingIds = useRef(new Set<string>());
  return useMemo(
    () => ({
      toggleCompleted: async (appointment: Pick<AppointmentView, 'id' | 'status' | 'version'>) => {
        if (pendingIds.current.has(appointment.id)) return;
        pendingIds.current.add(appointment.id);
        const nextStatus = appointment.status === 'DONE' ? 'SCHEDULED' : 'DONE';
        const result = await api.updateAppointmentStatus(appointment.id, nextStatus, { version: appointment.version });
        pendingIds.current.delete(appointment.id);
        showToast(
          result.ok
            ? { title: nextStatus === 'DONE' ? 'Đã đánh dấu hoàn thành lịch hẹn' : 'Đã mở lại lịch hẹn' }
            : { type: 'error', title: describeAppointmentError(result.error) },
        );
      },
      /** Dời lịch sang ngày + giờ VN mới; trả `true` nếu đã lưu. */
      rescheduleAppointment: async (appointment: Pick<AppointmentView, 'id' | 'version' | 'startAt' | 'endAt'>, date: string, time: string): Promise<boolean> => {
        if (pendingIds.current.has(appointment.id)) return false;
        pendingIds.current.add(appointment.id);
        const result = await api.updateAppointment(appointment.id, buildRescheduleBody(appointment, date, time));
        pendingIds.current.delete(appointment.id);
        showToast(result.ok ? { title: 'Đã đổi giờ lịch hẹn' } : { type: 'error', title: describeAppointmentError(result.error) });
        return result.ok;
      },
      /** Hủy lịch (lý do tùy chọn); toast có "Hoàn tác" mở lại lịch. Trả `true` nếu đã hủy. */
      cancelAppointment: async (appointment: Pick<AppointmentView, 'id' | 'version'>, reason?: string): Promise<boolean> => {
        if (pendingIds.current.has(appointment.id)) return false;
        pendingIds.current.add(appointment.id);
        const outcome = reason?.trim();
        const result = await api.updateAppointmentStatus(appointment.id, 'CANCELED', { version: appointment.version, ...(outcome ? { outcome } : {}) });
        pendingIds.current.delete(appointment.id);
        if (!result.ok) {
          showToast({ type: 'error', title: describeAppointmentError(result.error) });
          return false;
        }
        const canceledVersion = result.data.appointment.version;
        showToast({
          title: 'Đã hủy lịch hẹn',
          durationMs: UNDO_DURATION_MS,
          action: {
            label: 'Hoàn tác',
            onClick: async () => {
              const undo = await api.updateAppointmentStatus(appointment.id, 'SCHEDULED', { version: canceledVersion });
              showToast(undo.ok ? { title: 'Đã mở lại lịch hẹn' } : { type: 'error', title: describeAppointmentError(undo.error) });
            },
          },
        });
        return true;
      },
    }),
    [api, showToast],
  );
};
