// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/ReportsView.tsx theo phong cách Admin App
// (tài liệu 03): đầu trang có nút, tab module, thanh lọc (select gốc + nhãn trên), thẻ/chip/bảng Admin, icon lucide, cặp `dark:`.
// Thẻ KPI, donut SVG, thanh nguồn khách, điều khiển Tuần/Tháng/Quý/Năm vẽ theo Stitch bằng token Admin.
// Số liệu tính từ store (nguồn: số viết cứng 174/128/14/38...).
import {
  ArrowUpDown,
  CalendarCheck,
  ChartPie,
  Download,
  Headset,
  Megaphone,
  Star,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { PROJECTS, STAFF_LIST } from '@crm/data/mockData';
import { useCrmActions } from '@crm/store';
import {
  BUTTON_OUTLINE_CLASS,
  BUTTON_PRIMARY_CLASS,
  CAPTION_CLASS,
  CARD_CLASS,
  CHIP_CLASS,
  FILTER_INPUT_CLASS,
  PAGE_DESCRIPTION_CLASS,
  PAGE_TITLE_CLASS,
} from '@crm/lib/uiClasses';
import { LeadSourceBars, SegmentedBar, StatusDonut, StatusLegend } from './components/ReportCharts';
import { ChartCardHeader, ReportKpiCard, TimeRangeSegmented } from './components/ReportWidgets';
import { StaffPerformanceTable } from './components/StaffPerformance';
import { ALL_OPTION } from './reportStats';
import { useReportData } from './useReportData';

/** Select của thanh lọc: mẫu `ExternalLogsScreen.tsx:206`. */
const FILTER_SELECT_CLASS = `${FILTER_INPUT_CLASS} min-w-[200px] dark:[color-scheme:dark]`;

export const ReportsDesktop = () => {
  const { navigate, exportReport, showToast } = useCrmActions();
  const { filters, setFilter, timeRangeLabel, kpis, statusSegments, leadSources, staffRows, staffSortKey, toggleStaffSort } = useReportData();
  const activeSourceCount = leadSources.filter((source) => source.count > 0).length;

  return (
    <div className="flex w-full flex-col gap-6">
      {/* 1. Đầu trang có nút */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className={PAGE_TITLE_CLASS}>Báo cáo khách hàng</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl leading-relaxed`}>
            Thống kê, phân tích dữ liệu tương tác và hiệu suất chăm sóc khách hàng.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button type="button" onClick={exportReport} className={BUTTON_OUTLINE_CLASS}>
            <Download size={18} aria-hidden="true" />
            Xuất Excel / Báo cáo
          </button>
          <button type="button" onClick={() => navigate('create_customer')} className={BUTTON_PRIMARY_CLASS}>
            <UserPlus size={18} aria-hidden="true" />
            Thêm khách
          </button>
        </div>
      </header>

      {/* 2. Tab module */}
      <CrmModuleTabs />

      {/* 3. Thanh lọc (mẫu Admin: thẻ + trường nhãn trên) */}
      <section aria-label="Bộ lọc báo cáo" className={`${CARD_CLASS} flex flex-col flex-wrap gap-4 p-4 md:flex-row md:items-end md:justify-between`}>
        <div className="flex flex-col flex-wrap gap-4 sm:flex-row">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-project" className={CAPTION_CLASS}>
              Dự án
            </label>
            <select id="report-project" value={filters.project} onChange={(event) => setFilter('project', event.target.value)} className={FILTER_SELECT_CLASS}>
              <option value={ALL_OPTION}>Tất cả dự án</option>
              {PROJECTS.map((project) => (
                <option key={project.id} value={project.name}>
                  {project.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-staff" className={CAPTION_CLASS}>
              Nhân viên phụ trách
            </label>
            <select id="report-staff" value={filters.staffId} onChange={(event) => setFilter('staffId', event.target.value)} className={FILTER_SELECT_CLASS}>
              <option value={ALL_OPTION}>Tất cả nhân viên</option>
              {STAFF_LIST.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={CAPTION_CLASS}>Thời gian: {timeRangeLabel}</span>
          <TimeRangeSegmented value={filters.timeRange} onChange={(timeRange) => setFilter('timeRange', timeRange)} />
        </div>
      </section>

      {/* 4. KPI */}
      <section aria-label="Chỉ số tổng quan" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportKpiCard
          label="Tổng khách hàng"
          value={kpis.totalCustomers}
          icon={Users}
          iconBoxClass="bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
          badge={
            <span className={`${CHIP_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
              <TrendingUp size={12} aria-hidden="true" />
              +12%
            </span>
          }
          footnote="So với tháng trước (số liệu mẫu)"
        />
        <ReportKpiCard
          label="Đang chăm sóc"
          value={kpis.caringCount}
          icon={Headset}
          iconBoxClass="bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/10 dark:text-blue-light-500"
          valueClass="text-brand-600 dark:text-brand-400"
          badge={<span className={`${CHIP_CLASS} bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400`}>{kpis.caringPercent}%</span>}
          footnote="Khách có tương tác gần đây"
        />
        <ReportKpiCard
          label="Khách net (cao)"
          value={kpis.hotCount}
          icon={Star}
          iconBoxClass="bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500"
          valueClass="text-warning-700 dark:text-warning-500"
          badge={<span className={`${CHIP_CLASS} bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500`}>C/V {kpis.hotPercent}%</span>}
          footnote="Nhu cầu mua ngay & tài chính sẵn"
        />
        <ReportKpiCard
          label="Lịch hẹn xong"
          value={kpis.completedAppointments}
          icon={CalendarCheck}
          iconBoxClass="bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500"
          valueClass="text-success-600 dark:text-success-500"
          badge={
            <span className={`${CHIP_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
              {kpis.completionPercent}% hoàn thành
            </span>
          }
          footnote={`Trong kỳ: ${timeRangeLabel}`}
        />
      </section>

      {/* 5. Phân tích 2 cột (≥1280) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section aria-label="Phân bổ theo tình trạng" className={`${CARD_CLASS} @container flex flex-col justify-between p-6`}>
          <div>
            <ChartCardHeader
              icon={ChartPie}
              title="Phân bổ theo tình trạng"
              aside={<span className="shrink-0 text-theme-xs font-medium text-gray-500 dark:text-gray-400">Tổng {kpis.totalCustomers} khách</span>}
            />
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-theme-xs text-gray-500 dark:text-gray-400">
                <span>Tỷ lệ tiến độ phễu khách hàng</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">Đồng bộ từ hồ sơ CRM</span>
              </div>
              <SegmentedBar segments={statusSegments} />
            </div>
            <div className="mt-6 flex flex-col items-center gap-6 @md:flex-row">
              <StatusDonut segments={statusSegments} total={kpis.totalCustomers} />
              <StatusLegend segments={statusSegments} variant="boxed" />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between gap-2 border-t border-gray-100 pt-4 text-theme-xs text-gray-500 dark:border-white/[0.05] dark:text-gray-400">
            <span>Theo bộ lọc dự án / nhân viên hiện tại</span>
            <button type="button" onClick={() => navigate('customers')} className="font-medium text-brand-500 hover:underline dark:text-brand-400">
              Chi tiết danh sách khách →
            </button>
          </div>
        </section>

        <section aria-label="Nguồn khách hàng hiệu quả" className={`${CARD_CLASS} flex flex-col justify-between p-6`}>
          <div>
            <ChartCardHeader
              icon={Megaphone}
              title="Nguồn khách hàng hiệu quả"
              aside={<span className="shrink-0 text-theme-xs font-medium text-gray-500 dark:text-gray-400">{activeSourceCount} kênh có khách</span>}
            />
            <div className="mt-6">
              <LeadSourceBars sources={leadSources} />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between gap-2 border-t border-gray-100 pt-4 text-theme-xs text-gray-500 dark:border-white/[0.05] dark:text-gray-400">
            <span>Chi phí CPL trung bình: 142.000 đ/lead</span>
            <span className="text-gray-400 dark:text-gray-500">Gom theo trường “Nguồn khách”</span>
          </div>
        </section>
      </div>

      {/* 6. Bảng hiệu suất nhân sự */}
      <section aria-label="Hiệu suất chăm sóc theo nhân sự" className={`${CARD_CLASS} overflow-hidden`}>
        <div className="flex flex-col justify-between gap-4 border-b border-gray-100 p-5 sm:flex-row sm:items-center dark:border-white/[0.05]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Hiệu suất chăm sóc theo nhân sự</h3>
              <span className={`${CHIP_CLASS} bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500`}>
                Top {staffRows.length} nhân sự tháng này
              </span>
            </div>
            <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
              Đánh giá theo tỷ lệ hẹn khách và tỷ lệ chuyển đổi chốt cọc (số liệu mẫu).
            </p>
          </div>
          <button type="button" onClick={toggleStaffSort} className={`${BUTTON_OUTLINE_CLASS} shrink-0`}>
            <ArrowUpDown size={16} aria-hidden="true" />
            Sắp xếp: {staffSortKey === 'kpi' ? 'KPI cao nhất' : 'Nhiều khách nhất'}
          </button>
        </div>
        <StaffPerformanceTable
          rows={staffRows}
          onViewDetail={(staff) =>
            showToast({ title: `Phân tích KPI: ${staff.name}`, message: `${staff.kpiRate}% KPI • ${staff.salesOrDeposits}`, type: 'info' })
          }
        />
      </section>
    </div>
  );
};

export default ReportsDesktop;
