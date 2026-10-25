/**
 * "Lịch sắp tới tuần này" (web) - nội dung theo Admin Stitch AppointmentsView, vỏ thẻ Admin.
 * "Xem tất cả" mở rộng ra mọi lịch sắp tới (thay cho alert()).
 */
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useAppointments } from '@crm/api';
import { formatProjectSummary } from '@crm/lib/customerAdapters';
import { getAppointmentDateKey, getAppointmentTime } from '@crm/lib/appointmentAdapters';
import { useCrmActions } from '@crm/store';
import { formatShortWeekdayDate, getUpcomingAppointments, getWeekDates } from '../appointmentSchedule';
import { APPOINTMENT_TYPE_STYLES } from '../appointmentTypeStyles';
import { CAPTION_CLASS, CARD_CLASS, ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';

interface UpcomingAppointmentsCardProps {
  todayIso: string;
}

export const UpcomingAppointmentsCard = ({ todayIso }: UpcomingAppointmentsCardProps) => {
  const { data: appointments } = useAppointments({ status: 'SCHEDULED' });
  const { selectCustomer } = useCrmActions();
  const [isShowingAll, setIsShowingAll] = useState(false);

  const weekDates = getWeekDates(todayIso);
  const upcoming = getUpcomingAppointments(appointments, todayIso, isShowingAll ? undefined : weekDates[weekDates.length - 1]);

  return (
    <div className={`${CARD_CLASS} p-5`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={CAPTION_CLASS}>{isShowingAll ? 'Tất cả lịch sắp tới' : 'Lịch sắp tới tuần này'}</span>
        <button
          type="button"
          aria-expanded={isShowingAll}
          onClick={() => setIsShowingAll((isShowing) => !isShowing)}
          className="text-theme-xs font-medium text-brand-500 hover:underline dark:text-brand-400"
        >
          {isShowingAll ? 'Thu gọn' : 'Xem tất cả'}
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p className="py-3 text-theme-sm text-gray-500 dark:text-gray-400">Không có lịch hẹn sắp tới.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-white/[0.05]">
          {upcoming.map((appointment) => {
            const style = APPOINTMENT_TYPE_STYLES[appointment.type];
            return (
              <li key={appointment.id} className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-theme-xs font-semibold text-gray-700 dark:text-gray-300">
                      {formatShortWeekdayDate(getAppointmentDateKey(appointment))} • {getAppointmentTime(appointment)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.chipClass}`}>{style.shortLabel}</span>
                  </div>
                  <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{appointment.customer.fullName}</p>
                  <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
                    {appointment.customer.projects && appointment.customer.projects.length > 0 && `Dự án ${formatProjectSummary(appointment.customer.projects)} • `}Phụ trách: {appointment.assignee.displayName}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Mở hồ sơ ${appointment.customer.fullName}`}
                  onClick={() => selectCustomer(appointment.customer.id)}
                  className={`${ICON_BUTTON_CLASS} shrink-0`}
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
