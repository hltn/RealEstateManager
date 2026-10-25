/**
 * Màn Báo cáo (X6) dùng chung desktop + mobile — bố cục co giãn bằng Tailwind (mobile-first).
 * M8 (giai đoạn 2): CHƯA có API dashboard nên màn chạy trên DỮ LIỆU MẪU trong trình duyệt khi bật cờ `VITE_CRM_MOCK_REPORTS`
 * (mặc định bật ở dev, tắt ở production -> hiện thông báo "sắp ra mắt"). Số liệu mẫu KHÔNG phải số liệu thật của hệ thống.
 */
import { ChartPie, Construction, Download, FolderKanban, MapPin, Megaphone, RotateCcw, UserCheck, UserMinus, UserRound, UserRoundCheck, Users } from 'lucide-react';
import type { DashboardDateField } from '@crm/api';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import {
  BUTTON_OUTLINE_CLASS,
  CAPTION_CLASS,
  CARD_CLASS,
  FILTER_INPUT_CLASS,
  PAGE_DESCRIPTION_CLASS,
  PAGE_TITLE_CLASS,
  PAGE_TITLE_MOBILE_CLASS,
} from '@crm/lib/uiClasses';
import { BreakdownBars, SegmentedBar, StatusDonut, StatusLegend } from './components/ReportCharts';
import { ChartCardHeader, ReportKpiCard } from './components/ReportWidgets';
import { ALL_OPTION, REPORT_DATE_FIELD_OPTIONS, REPORT_PERIOD_OPTIONS, type ReportPeriod } from './reportStats';
import { useReportData } from './useReportData';

interface ReportsViewProps {
  variant: 'desktop' | 'mobile';
}

const FILTER_SELECT_CLASS = `${FILTER_INPUT_CLASS} w-full sm:min-w-[200px] dark:[color-scheme:dark]`;

const MockReportsContent = ({ variant }: ReportsViewProps) => {
  const { filters, setFilter, resetFilters, summary, statusSegments, leadSources, projects, areas, assigneeRows, projectOptions, assigneeOptions, exportCsv } =
    useReportData();
  const isDesktop = variant === 'desktop';

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className={isDesktop ? PAGE_TITLE_CLASS : PAGE_TITLE_MOBILE_CLASS}>Báo cáo &amp; Thống kê</h2>
            <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>
              Số khách theo tình trạng, nguồn khách, dự án, khu vực và người chăm sóc — tính trực tiếp từ hồ sơ khách trong phạm vi bạn được xem.
            </p>
          </div>
          {/* X8: xuất số liệu tổng hợp ra CSV (UTF-8 BOM — mở bằng Excel). */}
          <button type="button" onClick={exportCsv} className={`${BUTTON_OUTLINE_CLASS} shrink-0 self-start`}>
            <Download size={18} aria-hidden="true" />
            Xuất Excel (CSV)
          </button>
        </header>
        {isDesktop && <CrmModuleTabs />}
      </div>

      <section aria-label="Bộ lọc báo cáo" className={`${CARD_CLASS} flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end`}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-project" className={CAPTION_CLASS}>
            Dự án
          </label>
          <select id="report-project" value={filters.projectId} onChange={(event) => setFilter('projectId', event.target.value)} className={FILTER_SELECT_CLASS}>
            <option value={ALL_OPTION}>Tất cả dự án</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.isActive ? project.name : `${project.name} (đã ẩn)`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-staff" className={CAPTION_CLASS}>
            Người chăm sóc
          </label>
          <select id="report-staff" value={filters.assigneeId} onChange={(event) => setFilter('assigneeId', event.target.value)} className={FILTER_SELECT_CLASS}>
            <option value={ALL_OPTION}>Tất cả nhân sự</option>
            {assigneeOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-date-field" className={CAPTION_CLASS}>
            Tính theo
          </label>
          <select
            id="report-date-field"
            value={filters.dateField}
            onChange={(event) => setFilter('dateField', event.target.value as DashboardDateField)}
            className={FILTER_SELECT_CLASS}
          >
            {REPORT_DATE_FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-period" className={CAPTION_CLASS}>
            Thời gian
          </label>
          <select id="report-period" value={filters.period} onChange={(event) => setFilter('period', event.target.value as ReportPeriod)} className={FILTER_SELECT_CLASS}>
            {REPORT_PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {filters.period === 'custom' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="report-from" className={CAPTION_CLASS}>
                Từ ngày
              </label>
              <input
                id="report-from"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(event) => setFilter('from', event.target.value)}
                className={FILTER_SELECT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="report-to" className={CAPTION_CLASS}>
                Đến ngày
              </label>
              <input
                id="report-to"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(event) => setFilter('to', event.target.value)}
                className={FILTER_SELECT_CLASS}
              />
            </div>
          </>
        )}
        <button type="button" onClick={resetFilters} className={`${BUTTON_OUTLINE_CLASS} self-start sm:self-end`}>
          <RotateCcw size={16} aria-hidden="true" />
          Đặt lại
        </button>
      </section>

      <section aria-label="Chỉ số chính" className="grid grid-cols-2 gap-3 xl:grid-cols-5 xl:gap-4">
        <ReportKpiCard
          label="Tổng khách"
          className="col-span-2 xl:col-span-1"
          value={summary.totalCustomers}
          icon={Users}
          iconBoxClass="bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
          footnote={`Tiến độ TB ${summary.averageProgress.toLocaleString('vi-VN')}% · ${summary.staleCustomers} khách lâu chưa chăm sóc`}
          density={isDesktop ? 'default' : 'compact'}
        />
        <ReportKpiCard
          label={LIST_GROUP_LABELS.NOT_CONTACTED}
          value={summary.byListGroup.NOT_CONTACTED}
          icon={UserRound}
          iconBoxClass="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          footnote="Danh sách Chưa tiếp cận"
          density={isDesktop ? 'default' : 'compact'}
        />
        <ReportKpiCard
          label={LIST_GROUP_LABELS.INTERESTED}
          value={summary.byListGroup.INTERESTED}
          icon={UserRoundCheck}
          iconBoxClass="bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500"
          footnote="Danh sách Có quan tâm"
          density={isDesktop ? 'default' : 'compact'}
        />
        <ReportKpiCard
          label="Khách net"
          value={summary.byListGroup.NET}
          icon={UserCheck}
          iconBoxClass="bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500"
          footnote="Danh sách Khách net"
          density={isDesktop ? 'default' : 'compact'}
        />
        <ReportKpiCard
          label="Bỏ"
          value={summary.byListGroup.DROPPED}
          icon={UserMinus}
          iconBoxClass="bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500"
          footnote="Danh sách Bỏ"
          density={isDesktop ? 'default' : 'compact'}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <section className={`${CARD_CLASS} space-y-5 p-5`} aria-label="Khách theo tình trạng">
          <ChartCardHeader icon={ChartPie} title="Khách theo tình trạng" />
          <SegmentedBar segments={statusSegments} />
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            <StatusDonut segments={statusSegments} total={summary.totalCustomers} />
            <StatusLegend segments={statusSegments} variant={isDesktop ? 'boxed' : 'plain'} />
          </div>
        </section>

        <section className={`${CARD_CLASS} space-y-5 p-5`} aria-label="Khách theo nguồn">
          <ChartCardHeader icon={Megaphone} title="Khách theo nguồn" />
          <BreakdownBars rows={leadSources} />
        </section>

        <section className={`${CARD_CLASS} space-y-5 p-5`} aria-label="Khách theo dự án quan tâm">
          <ChartCardHeader icon={FolderKanban} title="Khách theo dự án quan tâm" subtitle="Một khách có thể quan tâm nhiều dự án" />
          <BreakdownBars rows={projects} />
        </section>

        <section className={`${CARD_CLASS} space-y-5 p-5`} aria-label="Khách theo khu vực">
          <ChartCardHeader icon={MapPin} title="Khách theo khu vực" subtitle="Khu vực khách đang sinh sống" />
          <BreakdownBars rows={areas} />
        </section>

        <section className={`${CARD_CLASS} space-y-4 p-5`} aria-label="Khách theo người chăm sóc">
          <ChartCardHeader icon={UserCheck} title="Khách theo người chăm sóc" subtitle="Tách phụ trách chính và cùng chăm sóc" />
          {assigneeRows.length === 0 ? (
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">Chưa có khách được phân công.</p>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="min-w-full text-theme-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-theme-xs uppercase text-gray-500 dark:border-white/[0.05] dark:text-gray-400">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Nhân viên
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Phụ trách chính
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Cùng chăm sóc
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Nhật ký
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Tiến độ TB
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {assigneeRows.map((row) => (
                    <tr key={row.user.id}>
                      <td className="py-2.5 pr-4 font-medium text-gray-800 dark:text-white/90">{row.user.label}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.primaryCount}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.memberCount}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.careLogCount}</td>
                      <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.averageProgress.toLocaleString('vi-VN')}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

/** Cổng cờ: tắt -> thông báo sắp ra mắt; bật -> báo cáo trên dữ liệu mẫu kèm biểu ngữ cảnh báo. */
export const ReportsView = ({ variant }: ReportsViewProps) => {
  if (!CRM_FEATURE_FLAGS.isMockReportsEnabled) {
    return (
      <div className="flex w-full flex-col gap-6">
        <CrmModuleTabs />
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center dark:border-white/[0.05] dark:bg-white/[0.03]">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
            <Construction size={32} aria-hidden="true" />
          </span>
          <p className="text-base font-medium text-gray-700 dark:text-gray-300">Báo cáo &amp; Thống kê sắp ra mắt</p>
          <p className="mt-1 max-w-sm text-theme-sm text-gray-500 dark:text-gray-400">Tính năng đang được hoàn thiện ở giai đoạn tiếp theo.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-4">
      <p role="note" className="rounded-xl border border-warning-100 bg-warning-50 px-4 py-3 text-theme-sm text-warning-700 dark:border-warning-500/25 dark:bg-warning-500/10 dark:text-warning-400">
        Dữ liệu mẫu (chưa nối API Báo cáo): số liệu dưới đây không phải dữ liệu thật của hệ thống.
      </p>
      <MockReportsContent variant={variant} />
    </div>
  );
};
