/**
 * Hàm thuần của màn Báo cáo (X6): chuyển bộ lọc UI -> `DashboardQuery` và số liệu dashboard -> dữ liệu biểu đồ.
 * Số liệu gốc tính ở `@crm/api` (dashboard) từ dữ liệu khách thật; ở đây chỉ định dạng, không tự đếm.
 */
import type { BreakdownItem, DashboardDateField, DashboardQuery } from '@crm/api';
import { STATUS_TONE_STYLES } from '@crm/components/statusToneStyles';
import { addDaysToDateKey } from '@crm/lib/dateTime';

export const ALL_OPTION = 'all';

export type ReportPeriod = 'all' | '7d' | '30d' | '90d' | 'custom';

export const REPORT_PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'all', label: 'Toàn thời gian' },
  { value: '7d', label: '7 ngày qua' },
  { value: '30d', label: '30 ngày qua' },
  { value: '90d', label: '90 ngày qua' },
  { value: 'custom', label: 'Tuỳ chọn' },
];

export const REPORT_DATE_FIELD_OPTIONS: { value: DashboardDateField; label: string }[] = [
  { value: 'createdAt', label: 'Ngày tạo khách' },
  { value: 'lastUpdatedAt', label: 'Ngày cập nhật cuối' },
];

export interface ReportFilters {
  period: ReportPeriod;
  dateField: DashboardDateField;
  /** Khoá ngày VN, chỉ dùng khi `period = custom`. */
  from: string;
  to: string;
  /** id dự án hoặc `ALL_OPTION`. */
  projectId: string;
  /** id người dùng (trong nhóm chăm sóc) hoặc `ALL_OPTION`. */
  assigneeId: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  period: 'all',
  dateField: 'createdAt',
  from: '',
  to: '',
  projectId: ALL_OPTION,
  assigneeId: ALL_OPTION,
};

const PERIOD_DAYS: Partial<Record<ReportPeriod, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** Bộ lọc UI -> truy vấn dashboard. "N ngày qua" = N ngày tính cả hôm nay (giờ VN). */
export const toDashboardQuery = (filters: ReportFilters, todayKey: string): DashboardQuery => {
  const query: DashboardQuery = { dateField: filters.dateField };
  const days = PERIOD_DAYS[filters.period];
  if (days) {
    query.from = addDaysToDateKey(todayKey, -(days - 1));
    query.to = todayKey;
  } else if (filters.period === 'custom') {
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
  }
  if (filters.projectId !== ALL_OPTION) query.projectIds = [filters.projectId];
  if (filters.assigneeId !== ALL_OPTION) query.assigneeIds = [filters.assigneeId];
  return query;
};

/** Nhãn kỳ báo cáo (dùng cho file xuất). */
export const getPeriodLabel = (filters: ReportFilters, query: DashboardQuery): string => {
  const fieldLabel = REPORT_DATE_FIELD_OPTIONS.find((option) => option.value === filters.dateField)?.label ?? '';
  if (!query.from && !query.to) return 'Toàn thời gian';
  return `${fieldLabel}: ${query.from ?? '...'} → ${query.to ?? '...'}`;
};

export interface StatusSegment {
  key: string;
  label: string;
  count: number;
  percent: number;
  fillClass: string;
  strokeClass: string;
  chipClass: string;
}

export const toStatusSegments = (items: BreakdownItem[]): StatusSegment[] =>
  items.map((item) => {
    const styles = STATUS_TONE_STYLES[item.tone ?? 'gray'];
    return {
      key: item.key.id,
      label: item.key.label,
      count: item.count,
      percent: item.percent,
      fillClass: styles.fillClass,
      strokeClass: styles.strokeClass,
      chipClass: styles.chipClass,
    };
  });

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  percent: number;
  averageProgress: number;
}

export const toBreakdownRows = (items: BreakdownItem[]): BreakdownRow[] =>
  items.map((item) => ({ key: item.key.id, label: item.key.label, count: item.count, percent: item.percent, averageProgress: item.averageProgress }));
