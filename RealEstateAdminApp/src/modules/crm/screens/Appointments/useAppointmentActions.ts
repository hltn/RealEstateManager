/**
 * Thao tác lịch hẹn dùng chung thẻ desktop/mobile/menu: đánh dấu hoàn thành / mở lại
 * (`PATCH /crm/appointments/:id/status`, gửi `version` khóa lạc quan) + toast tiếng Việt.
 * Chống bấm đúp: bỏ qua lần bấm khi thao tác trước cho cùng lịch chưa xong.
 */
import { useMemo, useRef } from 'react';
import { useCrmApi, type AppointmentView } from '@crm/api';
import { useCrmActions } from '@crm/store';

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
            : { type: 'error', title: result.error.message },
        );
      },
    }),
    [api, showToast],
  );
};
