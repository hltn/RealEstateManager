/**
 * 4 thẻ KPI (web) - bố cục "KPI Metric Cards" của Admin Stitch AppointmentsView,
 * vỏ thẻ + chip theo mẫu Admin (tài liệu 03 mục 5). Số đếm lấy từ store;
 * xu hướng "+15%" giữ nguyên nguồn vì prototype không có dữ liệu kỳ trước.
 */
import { BellRing, CalendarCheck, CalendarDays, CircleCheck, TrendingUp, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppointmentStats } from '../appointmentSchedule';
import { CAPTION_CLASS, CARD_CLASS, CHIP_CLASS } from '@crm/lib/uiClasses';

interface KpiCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  iconBoxClass: string;
  badge: ReactNode;
  footnote: string;
  isHighlighted?: boolean;
}

const KpiCard = ({ label, value, icon: Icon, iconBoxClass, badge, footnote, isHighlighted = false }: KpiCardProps) => (
  <div
    className={`${CARD_CLASS} relative flex flex-col justify-between overflow-hidden p-5 ${
      isHighlighted ? 'border-brand-200 dark:border-brand-500/30' : ''
    }`}
  >
    {isHighlighted && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-500" />}
    <div className="flex items-center justify-between gap-2">
      <span
        className={
          isHighlighted
            ? 'text-theme-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400'
            : CAPTION_CLASS
        }
      >
        {label}
      </span>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBoxClass}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
    </div>
    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-3xl font-semibold tracking-tight text-gray-800 dark:text-white/90">{value}</span>
      {badge}
    </div>
    <p className="mt-2 truncate text-theme-xs text-gray-500 dark:text-gray-400">{footnote}</p>
  </div>
);

interface AppointmentKpiCardsProps {
  stats: AppointmentStats;
  todayLabel: string;
  todaySummary: string;
}

export const AppointmentKpiCards = ({ stats, todayLabel, todaySummary }: AppointmentKpiCardsProps) => (
  <section aria-label="Chỉ số lịch hẹn" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <KpiCard
      label="Tổng cuộc hẹn"
      value={stats.total}
      icon={CalendarDays}
      iconBoxClass="bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
      badge={
        <span className={`${CHIP_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
          <TrendingUp size={12} aria-hidden="true" />
          +15%
        </span>
      }
      footnote="So với cùng kỳ tháng trước"
    />
    <KpiCard
      label={`Hôm nay (${todayLabel})`}
      value={stats.todayCount}
      icon={BellRing}
      iconBoxClass="bg-orange-50 text-orange-500 dark:bg-orange-500/10 dark:text-orange-400"
      badge={
        <span className={`${CHIP_CLASS} bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300`}>
          {stats.todayPendingCount} cần xử lý
        </span>
      }
      footnote={todaySummary || 'Không có lịch hẹn hôm nay'}
      isHighlighted
    />
    <KpiCard
      label="Sắp tới trong tuần"
      value={stats.upcomingWeekCount}
      icon={CalendarCheck}
      iconBoxClass="bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/10 dark:text-blue-light-500"
      badge={
        <span className={`${CHIP_CLASS} bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400`}>
          {stats.upcomingConfirmedPercent}% xác nhận
        </span>
      }
      footnote="Đã đồng bộ Google Calendar"
    />
    <KpiCard
      label="Hoàn thành tháng này"
      value={stats.monthCompletedCount}
      icon={CircleCheck}
      iconBoxClass="bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500"
      badge={
        <span className={`${CHIP_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
          {stats.monthCompletionPercent}% hoàn tất
        </span>
      }
      footnote="Hiệu suất dẫn khách đạt chuẩn KPI"
    />
  </section>
);
