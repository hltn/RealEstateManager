// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/AppointmentsView.tsx, theo phong cách Admin App
// (tài liệu 03): thẻ/chip/nút Admin, icon lucide, cặp `dark:`. Header/drawer là của Admin (không vẽ top app bar),
// thanh đáy `CrmBottomNav` do CrmLayout lo (đã chừa `pb-20`) nên không lặp `CrmModuleTabs` như nguồn.
// Dữ liệu lấy từ store; Tuần/Tháng/Danh sách hoạt động thật (nguồn: số liệu và dải ngày viết cứng).
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getVnTodayKey } from '@crm/lib/dateTime';
import { useAppointments, type AppointmentView } from '@crm/api';
import { useAppointmentsAround } from './useAppointmentsAround';
import { useCrmActions } from '@crm/store';
import type { DayPeriod } from '@crm/types/crm';
import {
  addDaysIso,
  countAppointmentsByDate,
  formatMonthYearVi,
  formatShortWeekdayDate,
  getAppointmentsInRange,
  getAppointmentsOnDate,
  getMonthRange,
  getUpcomingAppointments,
  groupAppointmentsByDate,
  groupAppointmentsByPeriod,
  parseIsoDate,
  shiftMonthIso,
} from './appointmentSchedule';
import {
  BUTTON_PRIMARY_CLASS,
  CARD_CLASS,
  NAV_ICON_BUTTON_CLASS,
  PAGE_DESCRIPTION_CLASS,
  PAGE_TITLE_MOBILE_CLASS,
} from '@crm/lib/uiClasses';
import { AppointmentCardMobile } from './components/AppointmentCardMobile';
import { MobileCalendarDays } from './components/MobileCalendarDays';

type ViewScope = 'week' | 'month' | 'list';

const DAYS_PER_WEEK = 7;

const VIEW_SCOPE_OPTIONS: { value: ViewScope; label: string }[] = [
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
  { value: 'list', label: 'Danh sách' },
];

const SESSION_META: Record<DayPeriod, { dotClass: string; label: string }> = {
  morning: { dotClass: 'bg-success-500', label: 'Buổi sáng (09:00 - 11:30)' },
  afternoon: { dotClass: 'bg-orange-400', label: 'Buổi chiều (14:00 - 17:30)' },
};

interface MetricTileProps {
  label: string;
  value: number;
  icon: LucideIcon;
  isHighlighted?: boolean;
}

/** Ô số liệu gọn 3 cột (bento Stitch) trên vỏ thẻ Admin. */
const MetricTile = ({ label, value, icon: Icon, isHighlighted = false }: MetricTileProps) => (
  <div
    className={`flex flex-col justify-between rounded-2xl border p-3 ${
      isHighlighted
        ? 'border-brand-100 bg-brand-50 dark:border-brand-500/25 dark:bg-brand-500/10'
        : 'border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]'
    }`}
  >
    <span className={`truncate text-theme-xs ${isHighlighted ? 'font-medium text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-400'}`}>
      {label}
    </span>
    <div className="mt-2 flex items-center justify-between">
      <span className={`text-2xl font-semibold ${isHighlighted ? 'text-brand-600 dark:text-brand-400' : 'text-gray-800 dark:text-white/90'}`}>
        {value}
      </span>
      <Icon size={18} aria-hidden="true" className="text-brand-500 dark:text-brand-400" />
    </div>
  </div>
);

interface SessionGroupProps {
  period: DayPeriod;
  appointments: AppointmentView[];
}

const SessionGroup = ({ period, appointments }: SessionGroupProps) => {
  const { dotClass, label } = SESSION_META[period];
  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">{label}</h3>
        </div>
        <span className="text-theme-xs text-gray-500 dark:text-gray-400">{appointments.length} lịch hẹn</span>
      </div>
      {appointments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 p-4 text-center text-theme-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Không có lịch hẹn trong buổi này.
        </p>
      ) : (
        appointments.map((appointment) => <AppointmentCardMobile key={appointment.id} appointment={appointment} />)
      )}
    </section>
  );
};

export const AppointmentsMobile = () => {
  const { data: appointments } = useAppointments();
  const { navigate } = useCrmActions();
  const [todayIso] = useState(() => getVnTodayKey());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const { data: browsed } = useAppointmentsAround(selectedDate);
  const [viewScope, setViewScope] = useState<ViewScope>('week');

  const countsByDate = useMemo(() => countAppointmentsByDate(browsed), [browsed]);
  const todayCount = countsByDate[todayIso] ?? 0;
  const upcomingCount = useMemo(() => getUpcomingAppointments(appointments, todayIso).length, [appointments, todayIso]);
  const dayAppointments = useMemo(() => getAppointmentsOnDate(browsed, selectedDate), [browsed, selectedDate]);
  const sessions = groupAppointmentsByPeriod(dayAppointments);
  const monthGroups = useMemo(() => {
    const { startIso, endIso } = getMonthRange(selectedDate);
    return groupAppointmentsByDate(getAppointmentsInRange(browsed, startIso, endIso));
  }, [browsed, selectedDate]);

  const visibleMonth = parseIsoDate(selectedDate) ?? new Date();
  const goToCreate = () => navigate('create_appointment');

  /** Chế độ Tuần lùi/tiến 7 ngày; Tháng/Danh sách nhảy về ngày 1 của tháng kề. */
  const shiftPeriod = (direction: -1 | 1) =>
    setSelectedDate((date) => (viewScope === 'week' ? addDaysIso(date, direction * DAYS_PER_WEEK) : shiftMonthIso(date, direction)));

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Tiêu đề + CTA */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={PAGE_TITLE_MOBILE_CLASS}>Lịch hẹn &amp; Nhắc việc</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} mt-0.5`}>Gặp khách, xem nhà, ký cọc và nhắc gọi lại</p>
        </div>
        <button type="button" onClick={goToCreate} className={`${BUTTON_PRIMARY_CLASS} shrink-0`}>
          <Plus size={18} aria-hidden="true" />
          Tạo lịch
        </button>
      </header>

      {/* Số liệu nhanh */}
      <section aria-label="Chỉ số lịch hẹn" className="grid grid-cols-3 gap-2.5">
        <MetricTile label="Tổng cuộc hẹn" value={appointments.length} icon={CalendarDays} />
        <MetricTile label="Hôm nay" value={todayCount} icon={CalendarClock} isHighlighted />
        <MetricTile label="Sắp tới" value={upcomingCount} icon={CalendarDays} />
      </section>

      {/* Điều khiển lịch */}
      <section aria-label="Chọn ngày" className={`${CARD_CLASS} space-y-3 p-3.5`}>
        <div role="group" aria-label="Chế độ xem" className="grid grid-cols-3 rounded-lg bg-gray-100 p-1 text-center text-xs dark:bg-gray-900">
          {VIEW_SCOPE_OPTIONS.map(({ value, label }) => {
            const isActive = viewScope === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setViewScope(value)}
                className={`rounded-md py-1.5 font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-brand-600 shadow-theme-xs dark:bg-gray-800 dark:text-brand-400'
                    : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <button type="button" aria-label={viewScope === 'week' ? 'Tuần trước' : 'Tháng trước'} onClick={() => shiftPeriod(-1)} className={NAV_ICON_BUTTON_CLASS}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-white/90">
            <CalendarDays size={18} aria-hidden="true" className="text-brand-500 dark:text-brand-400" />
            {formatMonthYearVi(visibleMonth.getFullYear(), visibleMonth.getMonth())}
          </div>
          <button type="button" aria-label={viewScope === 'week' ? 'Tuần sau' : 'Tháng sau'} onClick={() => shiftPeriod(1)} className={NAV_ICON_BUTTON_CLASS}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>

        {viewScope !== 'list' && (
          <MobileCalendarDays
            mode={viewScope}
            selectedDate={selectedDate}
            todayIso={todayIso}
            countsByDate={countsByDate}
            onSelectDate={setSelectedDate}
          />
        )}
      </section>

      {/* Lịch trong ngày theo buổi | danh sách cả tháng */}
      {viewScope === 'list' ? (
        monthGroups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-theme-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Không có lịch hẹn trong tháng này.
          </p>
        ) : (
          monthGroups.map((group) => (
            <section key={group.isoDate} aria-label={formatShortWeekdayDate(group.isoDate)} className="space-y-3">
              <h3 className="flex items-center justify-between text-sm font-semibold text-gray-800 dark:text-white/90">
                <span>
                  {formatShortWeekdayDate(group.isoDate)}
                  {group.isoDate === todayIso && <span className="ml-2 text-theme-xs font-medium text-brand-600 dark:text-brand-400">Hôm nay</span>}
                </span>
                <span className="text-theme-xs font-normal text-gray-500 dark:text-gray-400">{group.appointments.length} lịch hẹn</span>
              </h3>
              {group.appointments.map((appointment) => (
                <AppointmentCardMobile key={appointment.id} appointment={appointment} />
              ))}
            </section>
          ))
        )
      ) : (
        <>
          <SessionGroup period="morning" appointments={sessions.morning} />
          <SessionGroup period="afternoon" appointments={sessions.afternoon} />
        </>
      )}

      {/* Thêm nhanh */}
      <button
        type="button"
        onClick={goToCreate}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-3 text-xs font-medium text-gray-500 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-gray-700 dark:text-gray-400 dark:hover:border-brand-400 dark:hover:text-brand-400"
      >
        <CirclePlus size={18} aria-hidden="true" />
        Thêm nhắc việc hoặc lịch hẹn mới
      </button>
    </div>
  );
};

export default AppointmentsMobile;
