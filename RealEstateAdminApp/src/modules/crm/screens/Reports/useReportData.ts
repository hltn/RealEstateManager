/**
 * State bộ lọc báo cáo (cục bộ — không đụng `filters` của danh sách khách) + số liệu từ `useDashboardReport`.
 */
import { useMemo, useState } from 'react';
import { buildDashboardReportRows, type AssigneeStat, type DashboardSummary } from '@crm/api';
import { useDashboardReport, useMockCatalogs } from '@crm/api/mockHooks';
import { downloadCsv, toCsv } from '@crm/lib/csv';
import { getVnTodayKey } from '@crm/lib/dateTime';
import type { Project } from '@crm/types/crm';
import {
  DEFAULT_REPORT_FILTERS,
  getPeriodLabel,
  toBreakdownRows,
  toDashboardQuery,
  toStatusSegments,
  type BreakdownRow,
  type ReportFilters,
  type StatusSegment,
} from './reportStats';

export interface ReportData {
  filters: ReportFilters;
  setFilter: <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => void;
  resetFilters: () => void;
  summary: DashboardSummary;
  statusSegments: StatusSegment[];
  leadSources: BreakdownRow[];
  projects: BreakdownRow[];
  areas: BreakdownRow[];
  assigneeRows: AssigneeStat[];
  projectOptions: Project[];
  assigneeOptions: { id: string; label: string }[];
  exportCsv: () => void;
}

export const useReportData = (): ReportData => {
  // Báo cáo (M8) chạy trên DỮ LIỆU MẪU nên dùng danh mục mẫu cùng store, không dùng danh mục thật.
  const { catalogs, users } = useMockCatalogs();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const todayKey = getVnTodayKey();
  const query = useMemo(() => toDashboardQuery(filters, todayKey), [filters, todayKey]);
  const { data: report } = useDashboardReport(query);

  return {
    filters,
    setFilter: (key, value) => setFilters((previous) => ({ ...previous, [key]: value })),
    resetFilters: () => setFilters(DEFAULT_REPORT_FILTERS),
    summary: report.summary,
    statusSegments: useMemo(() => toStatusSegments(report.byStatus), [report.byStatus]),
    leadSources: useMemo(() => toBreakdownRows(report.bySource), [report.bySource]),
    projects: useMemo(() => toBreakdownRows(report.byProject), [report.byProject]),
    areas: useMemo(() => toBreakdownRows(report.byArea), [report.byArea]),
    assigneeRows: report.assignees,
    projectOptions: catalogs.projects.filter((project) => !project.deletedAt),
    assigneeOptions: users.filter((user) => user.role !== 'ADMIN' && user.isActive).map((user) => ({ id: user.id, label: user.fullName })),
    exportCsv: () => downloadCsv(`BaoCao_KhachHang_${todayKey}.csv`, toCsv(buildDashboardReportRows(report, getPeriodLabel(filters, query)))),
  };
};
