// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/ReportsView.tsx theo phong cách Admin App
// (thẻ/chip/select Admin, icon lucide, cặp `dark:`). Header/drawer là của Admin; CrmBottomNav do CrmLayout lo
// (thay cho tab module của nguồn — không lặp `CrmModuleTabs`).
// Số liệu tính từ store. Nút "bộ lọc thêm" mở thêm ô chọn dự án (nguồn: mở modal lọc của danh sách khách).
import {
  Building,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  Download,
  Headset,
  SlidersHorizontal,
  Star,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PROJECTS, STAFF_LIST } from '@crm/data/mockData';
import { useCrmActions } from '@crm/store';
import type { FilterTimeRange } from '@crm/types/crm';
import {
  BUTTON_SOFT_CLASS,
  CARD_CLASS,
  CHIP_SMALL_CLASS,
  PAGE_DESCRIPTION_CLASS,
  PAGE_TITLE_MOBILE_CLASS,
} from '@crm/lib/uiClasses';
import { LeadSourceBars, SegmentedBar, StatusLegend } from './components/ReportCharts';
import { ChartCardHeader, ReportKpiCard } from './components/ReportWidgets';
import { StaffRankingList } from './components/StaffPerformance';
import { ALL_OPTION, TIME_RANGE_OPTIONS } from './reportStats';
import { useReportData } from './useReportData';

const MOBILE_TOP_STAFF = 3;

interface PillSelectProps {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

/** Select dạng viên (Stitch) trên lớp ô nhập thanh lọc của Admin. */
const PillSelect = ({ id, label, icon: Icon, value, onChange, children }: PillSelectProps) => (
  <div className="relative shrink-0">
    <Icon size={16} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 max-w-[200px] appearance-none truncate rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-300 dark:[color-scheme:dark]"
    >
      {children}
    </select>
    <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
  </div>
);

export const ReportsMobile = () => {
  const { exportReport } = useCrmActions();
  const { filters, setFilter, timeRangeLabel, kpis, statusSegments, leadSources, staffRows } = useReportData();
  const [isShowingMoreFilters, setIsShowingMoreFilters] = useState(filters.project !== ALL_OPTION);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Tiêu đề + xuất file */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={PAGE_TITLE_MOBILE_CLASS}>Báo cáo khách hàng</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} mt-0.5`}>Thống kê &amp; hiệu suất chăm sóc</p>
        </div>
        <button type="button" onClick={exportReport} className={`${BUTTON_SOFT_CLASS} shrink-0`}>
          <Download size={18} aria-hidden="true" />
          Xuất file
        </button>
      </header>

      {/* Bộ lọc dạng viên, cuộn ngang */}
      <div className="space-y-2">
        <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
          <PillSelect
            id="report-time-mobile"
            label="Khoảng thời gian"
            icon={CalendarDays}
            value={filters.timeRange}
            onChange={(timeRange) => setFilter('timeRange', timeRange as FilterTimeRange)}
          >
            {TIME_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} này
              </option>
            ))}
          </PillSelect>
          <PillSelect id="report-staff-mobile" label="Nhân viên phụ trách" icon={UserRound} value={filters.staffId} onChange={(staffId) => setFilter('staffId', staffId)}>
            <option value={ALL_OPTION}>Tất cả nhân viên</option>
            {STAFF_LIST.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </PillSelect>
          <button
            type="button"
            aria-label="Bộ lọc thêm"
            aria-expanded={isShowingMoreFilters}
            onClick={() => setIsShowingMoreFilters((isShowing) => !isShowing)}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              isShowingMoreFilters
                ? 'border-brand-200 bg-brand-50 text-brand-500 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-400'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/5'
            }`}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </button>
        </div>
        {isShowingMoreFilters && (
          <PillSelect id="report-project-mobile" label="Dự án" icon={Building} value={filters.project} onChange={(project) => setFilter('project', project)}>
            <option value={ALL_OPTION}>Tất cả dự án</option>
            {PROJECTS.map((project) => (
              <option key={project.id} value={project.name}>
                {project.fullName}
              </option>
            ))}
          </PillSelect>
        )}
      </div>

      {/* KPI 2x2 */}
      <section aria-label="Chỉ số tổng quan" className="grid grid-cols-2 gap-3">
        <ReportKpiCard
          density="compact"
          label="Tổng khách"
          value={kpis.totalCustomers}
          icon={Users}
          iconBoxClass="bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
          badge={
            <span className="inline-flex items-center gap-0.5 text-theme-xs font-medium text-success-600 dark:text-success-500">
              <TrendingUp size={12} aria-hidden="true" />
              +12%
            </span>
          }
          footnote="vs tháng trước (mẫu)"
        />
        <ReportKpiCard
          density="compact"
          label="Chăm sóc"
          value={kpis.caringCount}
          icon={Headset}
          iconBoxClass="bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/10 dark:text-blue-light-500"
          footnote={`Chiếm ${kpis.caringPercent}%`}
        />
        <ReportKpiCard
          density="compact"
          label="Khách net"
          value={kpis.hotCount}
          icon={Star}
          iconBoxClass="bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500"
          footnote={`Tỷ lệ C/V ${kpis.hotPercent}%`}
        />
        <ReportKpiCard
          density="compact"
          label="Hẹn xong"
          value={kpis.completedAppointments}
          icon={CalendarCheck}
          iconBoxClass="bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500"
          footnote={timeRangeLabel}
        />
      </section>

      {/* Phân bổ trạng thái */}
      <section aria-label="Phân bổ theo tình trạng" className={`${CARD_CLASS} p-5`}>
        <ChartCardHeader
          title="Phân bổ theo tình trạng"
          subtitle="Tỷ trọng nhóm trạng thái hiện hành"
          aside={
            <span className={`${CHIP_SMALL_CLASS} shrink-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300`}>{kpis.totalCustomers} khách</span>
          }
        />
        <div className="mt-4 space-y-4">
          <SegmentedBar segments={statusSegments} />
          <StatusLegend segments={statusSegments} variant="plain" />
        </div>
      </section>

      {/* Nguồn khách */}
      <section aria-label="Nguồn khách hàng hiệu quả" className={`${CARD_CLASS} p-5`}>
        <ChartCardHeader title="Nguồn khách hàng hiệu quả" subtitle="Tỷ lệ đóng góp từ các kênh tiếp thị" />
        <div className="mt-4">
          <LeadSourceBars sources={leadSources} />
        </div>
      </section>

      {/* Xếp hạng nhân sự */}
      <section aria-label="Hiệu suất chăm sóc theo nhân sự" className={`${CARD_CLASS} p-5`}>
        <ChartCardHeader
          title="Hiệu suất theo nhân sự"
          subtitle="Xếp hạng theo KPI (số liệu mẫu)"
          aside={
            <span className={`${CHIP_SMALL_CLASS} shrink-0 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400`}>Top {MOBILE_TOP_STAFF}</span>
          }
        />
        <div className="mt-4">
          <StaffRankingList rows={staffRows.slice(0, MOBILE_TOP_STAFF)} />
        </div>
      </section>
    </div>
  );
};

export default ReportsMobile;
