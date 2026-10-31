// Khối "Lịch hẹn sắp tới" của chi tiết khách: để sau khi đặt lịch (quay về hồ sơ) người dùng thấy ngay lịch vừa tạo.
// Chỉ đọc: đổi giờ/hủy lịch làm ở màn Lịch hẹn. Dữ liệu: `GET /crm/appointments?customerId=&status=SCHEDULED` (60 ngày tới).
import { CalendarClock, MapPin } from 'lucide-react';
import { useAppointments } from '@crm/api';
import { APPOINTMENT_TYPE_LABELS, getAppointmentDateKey, getAppointmentTime } from '@crm/lib/appointmentAdapters';
import { addDaysToDateKey, getVnTodayKey } from '@crm/lib/dateTime';
import { CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, INSET_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { formatShortWeekdayDate } from '../../Appointments/appointmentSchedule';
import { selectUpcomingAppointments } from '../customerDetailUtils';
import { CardHeading } from './DetailParts';

/** Cửa sổ tìm lịch sắp tới (ngày); ≤ 62 ngày theo giới hạn của `GET /crm/appointments`. */
const UPCOMING_WINDOW_DAYS = 60;
const MAX_VISIBLE_APPOINTMENTS = 3;

interface UpcomingAppointmentsSectionProps {
  customerId: string;
}

export const UpcomingAppointmentsSection = ({ customerId }: UpcomingAppointmentsSectionProps) => {
  const today = getVnTodayKey();
  const { data, isLoading, error } = useAppointments({ customerId, status: 'SCHEDULED', from: today, to: addDaysToDateKey(today, UPCOMING_WINDOW_DAYS) });
  const upcoming = selectUpcomingAppointments(data);
  const hiddenCount = Math.max(0, upcoming.length - MAX_VISIBLE_APPOINTMENTS);

  return (
    <section aria-label="Lịch hẹn sắp tới" className={`${CARD_CLASS} space-y-4 p-5`}>
      <CardHeading icon={CalendarClock} title="Lịch hẹn sắp tới" as="h3" />
      {isLoading ? (
        <div aria-busy="true" aria-label="Đang tải lịch hẹn" className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : error ? (
        <p role="alert" className={MUTED_TEXT_CLASS}>
          Không tải được lịch hẹn của khách này.
        </p>
      ) : upcoming.length === 0 ? (
        <p className={MUTED_TEXT_CLASS}>Chưa có lịch hẹn sắp tới.</p>
      ) : (
        <ul className="space-y-2.5">
          {upcoming.slice(0, MAX_VISIBLE_APPOINTMENTS).map((appointment) => (
            <li key={appointment.id} className={`${INSET_CLASS} space-y-1 p-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <time dateTime={appointment.startAt} className="text-sm font-semibold text-gray-800 dark:text-white/90">
                  {formatShortWeekdayDate(getAppointmentDateKey(appointment))} • {getAppointmentTime(appointment)}
                </time>
                <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>{APPOINTMENT_TYPE_LABELS[appointment.type]}</span>
              </div>
              {appointment.project && <p className="truncate text-theme-xs text-gray-600 dark:text-gray-400">Dự án: {appointment.project.label}</p>}
              {appointment.location && (
                <p className="flex items-center gap-1.5 truncate text-theme-xs text-gray-600 dark:text-gray-400">
                  <MapPin size={14} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{appointment.location}</span>
                </p>
              )}
              <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">Phụ trách: {appointment.assignee.displayName}</p>
            </li>
          ))}
          {hiddenCount > 0 && <li className={MUTED_TEXT_CLASS}>và {hiddenCount} lịch hẹn khác</li>}
        </ul>
      )}
    </section>
  );
};
