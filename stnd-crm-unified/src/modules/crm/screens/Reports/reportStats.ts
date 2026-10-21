/**
 * Hàm thuần cho màn Báo cáo khách hàng: lọc theo dự án / nhân viên / khoảng thời gian, tính KPI,
 * phân bổ trạng thái, nguồn khách và xếp hạng nhân sự. Không phụ thuộc React.
 *
 * Giới hạn dữ liệu prototype: khách hàng không có ngày tạo -> khoảng thời gian chỉ áp cho LỊCH HẸN;
 * bảng hiệu suất nhân sự là số liệu mẫu (`INITIAL_STAFF_PERFORMANCE`), chỉ lọc theo nhân viên.
 */
import { INITIAL_STAFF_PERFORMANCE, STAFF_LIST } from '@crm/data/mockData';
import { isSameStaffName } from '@crm/lib/staff';
import { toIsoDate } from '@crm/lib/dateTime';
import type { Appointment, Customer, CustomerStatus, FilterTimeRange, StaffPerformance } from '@crm/types/crm';

export const ALL_OPTION = 'all';

export interface ReportFilters {
  timeRange: FilterTimeRange;
  /** Tên dự án hoặc `ALL_OPTION`. */
  project: string;
  /** id nhân viên (`STAFF_LIST`) hoặc `ALL_OPTION`. */
  staffId: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = { timeRange: 'month', project: ALL_OPTION, staffId: ALL_OPTION };

export const TIME_RANGE_OPTIONS: { value: FilterTimeRange; label: string }[] = [
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
  { value: 'quarter', label: 'Quý' },
  { value: 'year', label: 'Năm' },
];

const MONTHS_PER_QUARTER = 3;
const DAYS_PER_WEEK = 7;

/** Khoảng ngày ISO [start, end] của kỳ chứa `today` (tuần bắt đầu thứ Hai). */
export const getTimeRangeBounds = (timeRange: FilterTimeRange, today: Date): { startIso: string; endIso: string } => {
  const year = today.getFullYear();
  const month = today.getMonth();
  if (timeRange === 'week') {
    const mondayOffset = (today.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
    const monday = new Date(year, month, today.getDate() - mondayOffset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + DAYS_PER_WEEK - 1);
    return { startIso: toIsoDate(monday), endIso: toIsoDate(sunday) };
  }
  if (timeRange === 'quarter') {
    const firstMonth = Math.floor(month / MONTHS_PER_QUARTER) * MONTHS_PER_QUARTER;
    return {
      startIso: toIsoDate(new Date(year, firstMonth, 1)),
      endIso: toIsoDate(new Date(year, firstMonth + MONTHS_PER_QUARTER, 0)),
    };
  }
  if (timeRange === 'year') return { startIso: `${year}-01-01`, endIso: `${year}-12-31` };
  return { startIso: toIsoDate(new Date(year, month, 1)), endIso: toIsoDate(new Date(year, month + 1, 0)) };
};

/** Nhãn kỳ: "Tuần này", "Tháng này (10/2026)", "Quý 4/2026", "Năm 2026". */
export const getTimeRangeLabel = (timeRange: FilterTimeRange, today: Date): string => {
  const year = today.getFullYear();
  if (timeRange === 'week') return 'Tuần này';
  if (timeRange === 'quarter') return `Quý ${Math.floor(today.getMonth() / MONTHS_PER_QUARTER) + 1}/${year}`;
  if (timeRange === 'year') return `Năm ${year}`;
  return `Tháng này (${String(today.getMonth() + 1).padStart(2, '0')}/${year})`;
};

/** Họ tên nhân viên đang lọc ('' = tất cả). Mọi trường tên nhân viên dùng họ tên đầy đủ của STAFF_LIST. */
const getStaffNameById = (staffId: string): string => STAFF_LIST.find((member) => member.id === staffId)?.name ?? '';

export const filterReportCustomers = (customers: Customer[], filters: ReportFilters): Customer[] => {
  const staffName = getStaffNameById(filters.staffId);
  return customers.filter(
    (customer) =>
      (filters.project === ALL_OPTION || customer.interestedProjects.includes(filters.project)) &&
      (!staffName || isSameStaffName(customer.staffLead, staffName)),
  );
};

export const filterReportAppointments = (appointments: Appointment[], filters: ReportFilters, today: Date): Appointment[] => {
  const { startIso, endIso } = getTimeRangeBounds(filters.timeRange, today);
  const staffName = getStaffNameById(filters.staffId);
  return appointments.filter(
    (appointment) =>
      appointment.date >= startIso &&
      appointment.date <= endIso &&
      (filters.project === ALL_OPTION || appointment.projectName === filters.project) &&
      (!staffName || isSameStaffName(appointment.leadStaffName, staffName)),
  );
};

export const toPercent = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

// ---------------------------------------------------------------------------
// Phân bổ trạng thái
// ---------------------------------------------------------------------------

export interface StatusSegment {
  status: CustomerStatus;
  label: string;
  count: number;
  percent: number;
  /** Nền chấm/thanh. */
  fillClass: string;
  /** Màu nét SVG (dùng `stroke="currentColor"`). */
  strokeClass: string;
  chipClass: string;
}

const STATUS_SEGMENT_META: Record<CustomerStatus, Omit<StatusSegment, 'status' | 'count' | 'percent'>> = {
  'Có quan tâm': {
    label: 'Đang chăm sóc',
    fillClass: 'bg-brand-500',
    strokeClass: 'text-brand-500',
    chipClass: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
  },
  'Khách net': {
    label: 'Khách net (nóng)',
    fillClass: 'bg-warning-500',
    strokeClass: 'text-warning-500',
    chipClass: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500',
  },
  'Chưa tiếp cận': {
    label: 'Chưa tiếp cận',
    fillClass: 'bg-gray-400 dark:bg-gray-500',
    strokeClass: 'text-gray-400 dark:text-gray-500',
    chipClass: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  'Bỏ / Không nhu cầu': {
    label: 'Bỏ / Không nhu cầu',
    fillClass: 'bg-error-500',
    strokeClass: 'text-error-500',
    chipClass: 'bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500',
  },
};

const STATUS_ORDER: CustomerStatus[] = ['Có quan tâm', 'Khách net', 'Chưa tiếp cận', 'Bỏ / Không nhu cầu'];

export const getStatusSegments = (customers: Customer[]): StatusSegment[] =>
  STATUS_ORDER.map((status) => {
    const count = customers.filter((customer) => customer.status === status).length;
    return { status, count, percent: toPercent(count, customers.length), ...STATUS_SEGMENT_META[status] };
  });

// ---------------------------------------------------------------------------
// Nguồn khách
// ---------------------------------------------------------------------------

export type LeadSourceKey = 'facebook' | 'website' | 'referral' | 'other';

export interface LeadSourceStat {
  key: LeadSourceKey;
  label: string;
  count: number;
  percent: number;
  fillClass: string;
  textClass: string;
}

const LEAD_SOURCE_META: Record<LeadSourceKey, Omit<LeadSourceStat, 'key' | 'count' | 'percent'>> = {
  facebook: { label: 'Facebook Ads', fillClass: 'bg-brand-500', textClass: 'text-brand-600 dark:text-brand-400' },
  website: { label: 'Website STND Real Estate', fillClass: 'bg-blue-light-500', textClass: 'text-blue-light-600 dark:text-blue-light-500' },
  referral: { label: 'Giới thiệu (Referral)', fillClass: 'bg-theme-purple-500', textClass: 'text-theme-purple-500' },
  other: { label: 'Kênh khác (Telesale / Sự kiện)', fillClass: 'bg-gray-400 dark:bg-gray-500', textClass: 'text-gray-600 dark:text-gray-400' },
};

const LEAD_SOURCE_ORDER: LeadSourceKey[] = ['facebook', 'website', 'referral', 'other'];

/** Gom `leadSource` tự do về 4 kênh chủ lực. */
export const classifyLeadSource = (leadSource: string): LeadSourceKey => {
  const source = leadSource.trim().toLowerCase();
  if (source.includes('facebook')) return 'facebook';
  if (source.includes('website')) return 'website';
  if (source.includes('giới thiệu') || source.includes('referral')) return 'referral';
  return 'other';
};

export const getLeadSourceStats = (customers: Customer[]): LeadSourceStat[] =>
  LEAD_SOURCE_ORDER.map((key) => {
    const count = customers.filter((customer) => classifyLeadSource(customer.leadSource) === key).length;
    return { key, count, percent: toPercent(count, customers.length), ...LEAD_SOURCE_META[key] };
  });

// ---------------------------------------------------------------------------
// KPI + nhân sự
// ---------------------------------------------------------------------------

export interface ReportKpis {
  totalCustomers: number;
  caringCount: number;
  caringPercent: number;
  hotCount: number;
  hotPercent: number;
  completedAppointments: number;
  completionPercent: number;
}

export const getReportKpis = (customers: Customer[], appointments: Appointment[]): ReportKpis => {
  const caringCount = customers.filter((customer) => customer.status === 'Có quan tâm').length;
  const hotCount = customers.filter((customer) => customer.status === 'Khách net').length;
  const completedAppointments = appointments.filter((appointment) => appointment.isCompleted).length;
  return {
    totalCustomers: customers.length,
    caringCount,
    caringPercent: toPercent(caringCount, customers.length),
    hotCount,
    hotPercent: toPercent(hotCount, customers.length),
    completedAppointments,
    completionPercent: toPercent(completedAppointments, appointments.length),
  };
};

export type StaffSortKey = 'kpi' | 'customers';

/** Bảng hiệu suất (số liệu mẫu): lọc theo nhân viên đang chọn, sắp xếp theo KPI hoặc số khách. */
export const getStaffPerformance = (staffId: string, sortKey: StaffSortKey): StaffPerformance[] => {
  const staffName = getStaffNameById(staffId);
  return INITIAL_STAFF_PERFORMANCE.filter((staff) => !staffName || isSameStaffName(staff.name, staffName)).sort(
    (first, second) => (sortKey === 'kpi' ? second.kpiRate - first.kpiRate : second.customersHandled - first.customersHandled),
  );
};

/** Màu thanh KPI: đạt (≥100) xanh, khá (≥70) brand, còn lại cảnh báo. */
export const getKpiBarClass = (kpiRate: number): string => {
  if (kpiRate >= 100) return 'bg-success-500';
  if (kpiRate >= 70) return 'bg-brand-500';
  return 'bg-warning-500';
};
