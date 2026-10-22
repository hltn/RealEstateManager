/**
 * Thao tác lịch hẹn dùng chung thẻ desktop/mobile/menu: đánh dấu hoàn thành / hoàn tác
 * (`PATCH /crm/appointments/:id/status`) + toast.
 */
import { useMemo } from 'react';
import { useCrmApi, type AppointmentView } from '@crm/api';
import { useCrmActions } from '@crm/store';

export const useAppointmentActions = () => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  return useMemo(
    () => ({
      toggleCompleted: (appointment: Pick<AppointmentView, 'id' | 'status'>) => {
        const nextStatus = appointment.status === 'DONE' ? 'SCHEDULED' : 'DONE';
        const result = api.updateAppointmentStatus(appointment.id, nextStatus);
        showToast(result.ok ? { title: nextStatus === 'DONE' ? 'Đã đánh dấu hoàn thành lịch hẹn' : 'Đã hoàn tác trạng thái lịch hẹn' } : { type: 'error', title: result.error.message });
      },
    }),
    [api, showToast],
  );
};
