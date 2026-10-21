/**
 * State bộ lọc (cục bộ — không đụng `filters` của danh sách khách) + số liệu báo cáo dẫn xuất từ store CRM.
 * Dùng chung desktop + mobile.
 */
import { useMemo, useState } from 'react';
import { useCrmState } from '@crm/store';
import type { StaffPerformance } from '@crm/types/crm';
import {
  DEFAULT_REPORT_FILTERS,
  filterReportAppointments,
  filterReportCustomers,
  getLeadSourceStats,
  getReportKpis,
  getStaffPerformance,
  getStatusSegments,
  getTimeRangeLabel,
  type LeadSourceStat,
  type ReportFilters,
  type ReportKpis,
  type StaffSortKey,
  type StatusSegment,
} from './reportStats';

export interface ReportData {
  filters: ReportFilters;
  setFilter: <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => void;
  timeRangeLabel: string;
  kpis: ReportKpis;
  statusSegments: StatusSegment[];
  leadSources: LeadSourceStat[];
  staffRows: StaffPerformance[];
  staffSortKey: StaffSortKey;
  toggleStaffSort: () => void;
}

export const useReportData = (): ReportData => {
  const { customers, appointments } = useCrmState();
  const [today] = useState(() => new Date());
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [staffSortKey, setStaffSortKey] = useState<StaffSortKey>('kpi');

  const filteredCustomers = useMemo(() => filterReportCustomers(customers, filters), [customers, filters]);
  const filteredAppointments = useMemo(
    () => filterReportAppointments(appointments, filters, today),
    [appointments, filters, today],
  );

  const kpis = useMemo(() => getReportKpis(filteredCustomers, filteredAppointments), [filteredCustomers, filteredAppointments]);
  const statusSegments = useMemo(() => getStatusSegments(filteredCustomers), [filteredCustomers]);
  const leadSources = useMemo(() => getLeadSourceStats(filteredCustomers), [filteredCustomers]);
  const staffRows = useMemo(() => getStaffPerformance(filters.staffId, staffSortKey), [filters.staffId, staffSortKey]);

  return {
    filters,
    setFilter: (key, value) => setFilters((previous) => ({ ...previous, [key]: value })),
    timeRangeLabel: getTimeRangeLabel(filters.timeRange, today),
    kpis,
    statusSegments,
    leadSources,
    staffRows,
    staffSortKey,
    toggleStaffSort: () => setStaffSortKey((key) => (key === 'kpi' ? 'customers' : 'kpi')),
  };
};
