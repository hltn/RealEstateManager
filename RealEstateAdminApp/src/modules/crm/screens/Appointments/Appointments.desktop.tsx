// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/AppointmentsView.tsx,
// chỉnh sang phong cách Admin App (tài liệu 03): đầu trang + tab module + thẻ/chip/nút Admin, icon lucide, cặp `dark:`.
// Dữ liệu lấy từ store (thay các thẻ sự kiện viết cứng); ngày hôm nay = ngày hệ thống.
import { Plus, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { formatIsoDateVi, toIsoDate } from '@crm/lib/dateTime';
import { useCrmActions, useCrmState } from '@crm/store';
import type { Appointment, DayPeriod } from '@crm/types/crm';
import {
  addDaysIso,
  countAppointmentsByDate,
  getAppointmentStats,
  getAppointmentsOnDate,
  getWeekDates,
  groupAppointmentsByPeriod,
  summarizeAppointmentTypes,
} from './appointmentSchedule';
import { BUTTON_PRIMARY_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS } from '@crm/lib/uiClasses';
import { AiSuggestionCard } from './components/AiSuggestionCard';
import { AppointmentCardDesktop } from './components/AppointmentCardDesktop';
import { AppointmentKpiCards } from './components/AppointmentKpiCards';
import { MiniMonthCalendar } from './components/MiniMonthCalendar';
import { UpcomingAppointmentsCard } from './components/UpcomingAppointmentsCard';
import { WeekRibbon } from './components/WeekRibbon';

const DAYS_PER_WEEK = 7;

const SESSION_META: Record<DayPeriod, { icon: LucideIcon; iconClass: string; label: string }> = {
  morning: { icon: Sunrise, iconClass: 'text-warning-500', label: 'Buổi sáng (09:00 - 11:30)' },
  afternoon: { icon: Sun, iconClass: 'text-orange-500 dark:text-orange-400', label: 'Buổi chiều (14:00 - 17:30)' },
};

interface DaySessionProps {
  period: DayPeriod;
  appointments: Appointment[];
}

const DaySession = ({ period, appointments }: DaySessionProps) => {
  const { icon: Icon, iconClass, label } = SESSION_META[period];
  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={18} aria-hidden="true" className={iconClass} />
        <h3 className="text-theme-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
          {label} • <span className="text-brand-600 dark:text-brand-400">{appointments.length} sự kiện</span>
        </h3>
      </div>
      {appointments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 p-5 text-center text-theme-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Không có lịch hẹn trong buổi này.
        </p>
      ) : (
        appointments.map((appointment) => <AppointmentCardDesktop key={appointment.id} appointment={appointment} />)
      )}
    </section>
  );
};

export const AppointmentsDesktop = () => {
  const { appointments } = useCrmState();
  const { navigate } = useCrmActions();
  const [todayIso] = useState(() => toIsoDate(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayIso);

  const stats = useMemo(() => getAppointmentStats(appointments, todayIso), [appointments, todayIso]);
  const countsByDate = useMemo(() => countAppointmentsByDate(appointments), [appointments]);
  const todaySummary = useMemo(
    () => summarizeAppointmentTypes(getAppointmentsOnDate(appointments, todayIso)),
    [appointments, todayIso],
  );
  const dayAppointments = useMemo(() => getAppointmentsOnDate(appointments, selectedDate), [appointments, selectedDate]);
  const sessions = groupAppointmentsByPeriod(dayAppointments);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* 1. Đầu trang có nút (mẫu RawArticlesScreen) */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className={PAGE_TITLE_CLASS}>Lịch hẹn &amp; Nhắc việc</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl leading-relaxed`}>
            Quản lý lịch gặp gỡ, dẫn khách xem nhà mẫu, ký cọc và nhắc gọi tư vấn.
          </p>
        </div>
        <button type="button" onClick={() => navigate('create_appointment')} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start md:self-auto`}>
          <Plus size={18} aria-hidden="true" />
          Tạo lịch hẹn mới
        </button>
      </header>

      {/* 2. Tab module */}
      <CrmModuleTabs />

      {/* 3. KPI */}
      <AppointmentKpiCards stats={stats} todayLabel={formatIsoDateVi(todayIso).slice(0, 5)} todaySummary={todaySummary} />

      {/* 4. Lịch tuần + ca trong ngày | lịch tháng + AI + sắp tới */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-8">
          <WeekRibbon
            weekDates={getWeekDates(selectedDate)}
            selectedDate={selectedDate}
            todayIso={todayIso}
            countsByDate={countsByDate}
            todayPendingCount={stats.todayPendingCount}
            onSelectDate={setSelectedDate}
            onShiftWeek={(direction) => setSelectedDate((date) => addDaysIso(date, direction * DAYS_PER_WEEK))}
          />
          <DaySession period="morning" appointments={sessions.morning} />
          <DaySession period="afternoon" appointments={sessions.afternoon} />
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <MiniMonthCalendar selectedDate={selectedDate} todayIso={todayIso} countsByDate={countsByDate} onSelectDate={setSelectedDate} />
          <AiSuggestionCard appointments={dayAppointments} selectedDate={selectedDate} todayIso={todayIso} />
          <div className="md:col-span-2 xl:col-span-1">
            <UpcomingAppointmentsCard todayIso={todayIso} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppointmentsDesktop;
