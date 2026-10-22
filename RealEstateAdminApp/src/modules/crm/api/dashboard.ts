/**
 * Thống kê Dashboard (X6 — 05 §2.13 `GET /crm/dashboard/summary | breakdowns | assignee-stats`), tính THẬT từ dữ liệu
 * khách trong phạm vi quyền. Bộ lọc thời gian áp cho dữ liệu khách theo ngày tạo hoặc ngày cập nhật cuối (giờ VN).
 */
import { getListGroupOfStatus, getProgressPercent, isInCareTeam, isStaleCustomer, LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { toVnDateKey } from '@crm/lib/dateTime';
import { toProjectLabel } from '@crm/lib/projectRules';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { Customer, ListGroup, Ref, StatusTone } from '@crm/types/crm';
import type { CrmActor } from './access';
import { getAccessibleCustomers, toStatusRef } from './queries';

export type DashboardDateField = 'createdAt' | 'lastUpdatedAt';

export interface DashboardQuery {
  /** Khoá ngày VN (bao gồm); rỗng = không giới hạn. */
  from?: string;
  to?: string;
  dateField?: DashboardDateField;
  projectIds?: string[];
  /** Lọc khách có người này trong nhóm chăm sóc. */
  assigneeIds?: string[];
}

export type BreakdownDimension = 'status' | 'source' | 'project' | 'area' | 'primaryAssignee' | 'tag';

export interface BreakdownItem {
  key: Ref;
  count: number;
  averageProgress: number;
  /** % trên tổng khách của kỳ (một khách có thể thuộc nhiều nhóm với dự án/thẻ). */
  percent: number;
  /** Chỉ có với chiều `status`. */
  tone?: StatusTone;
}

export interface DashboardSummary {
  totalCustomers: number;
  byListGroup: Record<ListGroup, number>;
  averageProgress: number;
  appointmentsDone: number;
  staleCustomers: number;
}

export interface AssigneeStat {
  user: Ref;
  primaryCount: number;
  memberCount: number;
  careLogCount: number;
  averageProgress: number;
}

const UNKNOWN_KEY: Ref = { id: 'unknown', label: 'Chưa cập nhật' };
const round1 = (value: number): number => Math.round(value * 10) / 10;
const average = (values: number[]): number => (values.length === 0 ? 0 : round1(values.reduce((sum, value) => sum + value, 0) / values.length));

/** Khách trong phạm vi + bộ lọc dashboard. */
export const queryDashboardCustomers = (state: CrmDataState, actor: CrmActor, query: DashboardQuery = {}): Customer[] => {
  const dateField = query.dateField ?? 'createdAt';
  return getAccessibleCustomers(state, actor).filter((customer) => {
    const dateKey = toVnDateKey(customer[dateField]);
    if (query.from && dateKey < query.from) return false;
    if (query.to && dateKey > query.to) return false;
    if (query.projectIds?.length && !customer.interestedProjectIds.some((id) => query.projectIds?.includes(id))) return false;
    if (query.assigneeIds?.length && !query.assigneeIds.some((userId) => isInCareTeam(customer.careTeam, userId))) return false;
    return true;
  });
};

/** `GET /crm/dashboard/summary` */
export const getDashboardSummary = (state: CrmDataState, actor: CrmActor, query: DashboardQuery = {}, staleDays = state.settings.staleCustomerDays, now: Date = new Date()): DashboardSummary => {
  const customers = queryDashboardCustomers(state, actor, query);
  const ids = new Set(customers.map((customer) => customer.id));
  const byListGroup: Record<ListGroup, number> = { NOT_CONTACTED: 0, INTERESTED: 0, NET: 0, DROPPED: 0 };
  customers.forEach((customer) => {
    byListGroup[getListGroupOfStatus(state.catalogs.statuses, customer.statusId)] += 1;
  });
  return {
    totalCustomers: customers.length,
    byListGroup,
    averageProgress: average(customers.map((customer) => getProgressPercent(customer.criteria))),
    appointmentsDone: state.appointments.filter((appointment) => ids.has(appointment.customerId) && appointment.status === 'DONE').length,
    staleCustomers: customers.filter((customer) => isStaleCustomer(customer, state.catalogs.statuses, staleDays, now)).length,
  };
};

const keysOf = (state: CrmDataState, customer: Customer, dimension: BreakdownDimension): Ref[] => {
  const { catalogs, users } = state;
  switch (dimension) {
    case 'status': {
      const status = toStatusRef(catalogs, customer.statusId);
      return [{ id: status.id, label: status.label }];
    }
    case 'source': {
      const source = catalogs.leadSources.find((item) => item.id === customer.sourceId);
      return source ? [{ id: source.id, label: source.label }] : [];
    }
    case 'area': {
      const area = catalogs.areas.find((item) => item.id === customer.areaId);
      return area ? [{ id: area.id, label: area.name }] : [];
    }
    case 'project':
      return customer.interestedProjectIds.map((id) => ({ id, label: toProjectLabel(catalogs.projects, id) }));
    case 'tag':
      return customer.tagIds.flatMap((id) => {
        const tag = catalogs.tags.find((item) => item.id === id);
        return tag ? [{ id: tag.id, label: tag.name }] : [];
      });
    default: {
      const user = users.find((item) => item.id === customer.primaryAssigneeId);
      return user ? [{ id: user.id, label: user.displayName }] : [];
    }
  }
};

/** `GET /crm/dashboard/breakdowns?dimension=` — sắp giảm dần theo số khách; "Chưa cập nhật" luôn cuối. */
export const getDashboardBreakdown = (state: CrmDataState, actor: CrmActor, dimension: BreakdownDimension, query: DashboardQuery = {}): BreakdownItem[] => {
  const customers = queryDashboardCustomers(state, actor, query);
  const groups = new Map<string, { key: Ref; progresses: number[] }>();
  customers.forEach((customer) => {
    const keys = keysOf(state, customer, dimension);
    (keys.length > 0 ? keys : [UNKNOWN_KEY]).forEach((key) => {
      const group = groups.get(key.id) ?? { key, progresses: [] };
      group.progresses.push(getProgressPercent(customer.criteria));
      groups.set(key.id, group);
    });
  });
  const items = [...groups.values()].map(({ key, progresses }) => ({
    key,
    count: progresses.length,
    averageProgress: average(progresses),
    percent: customers.length > 0 ? round1((progresses.length / customers.length) * 100) : 0,
    tone: dimension === 'status' ? state.catalogs.statuses.find((status) => status.id === key.id)?.tone : undefined,
  }));
  if (dimension === 'status') {
    // Tình trạng: giữ thứ tự danh mục, hiện cả tình trạng 0 khách.
    const active = state.catalogs.statuses
      .filter((status) => status.isActive)
      .sort((a, b) => a.order - b.order)
      .map((status) => items.find((item) => item.key.id === status.id) ?? { key: { id: status.id, label: status.label }, count: 0, averageProgress: 0, percent: 0, tone: status.tone });
    // Khách còn gắn tình trạng ĐÃ ẨN gộp thành 1 nhóm "Đã ẩn" để tổng các đoạn luôn khớp tổng khách.
    const activeIds = new Set(active.map((item) => item.key.id));
    const hidden = items.filter((item) => !activeIds.has(item.key.id));
    if (hidden.length === 0) return active;
    const hiddenCount = hidden.reduce((sum, item) => sum + item.count, 0);
    const hiddenProgress = hidden.reduce((sum, item) => sum + item.averageProgress * item.count, 0);
    return [
      ...active,
      {
        key: { id: 'hidden-statuses', label: 'Tình trạng đã ẩn' },
        count: hiddenCount,
        averageProgress: hiddenCount > 0 ? round1(hiddenProgress / hiddenCount) : 0,
        percent: customers.length > 0 ? round1((hiddenCount / customers.length) * 100) : 0,
        tone: 'gray' as const,
      },
    ];
  }
  return items.sort((first, second) => {
    if (first.key.id === UNKNOWN_KEY.id) return 1;
    if (second.key.id === UNKNOWN_KEY.id) return -1;
    return second.count - first.count || first.key.label.localeCompare(second.key.label, 'vi');
  });
};

/** `GET /crm/dashboard/assignee-stats` — tách "phụ trách chính" và "cùng chăm sóc". */
export const getAssigneeStats = (state: CrmDataState, actor: CrmActor, query: DashboardQuery = {}): AssigneeStat[] => {
  const customers = queryDashboardCustomers(state, actor, query);
  const ids = new Set(customers.map((customer) => customer.id));
  return state.users
    .filter((user) => user.role !== 'ADMIN')
    .map((user) => {
      const primary = customers.filter((customer) => customer.primaryAssigneeId === user.id);
      const member = customers.filter((customer) => customer.primaryAssigneeId !== user.id && isInCareTeam(customer.careTeam, user.id));
      return {
        user: { id: user.id, label: user.fullName },
        primaryCount: primary.length,
        memberCount: member.length,
        careLogCount: state.careLogs.filter((log) => log.authorId === user.id && ids.has(log.customerId)).length,
        averageProgress: average(primary.map((customer) => getProgressPercent(customer.criteria))),
      };
    })
    .filter((row) => row.primaryCount + row.memberCount > 0)
    .sort((first, second) => second.primaryCount - first.primaryCount || second.memberCount - first.memberCount);
};

export interface DashboardReport {
  summary: DashboardSummary;
  byStatus: BreakdownItem[];
  bySource: BreakdownItem[];
  byProject: BreakdownItem[];
  byArea: BreakdownItem[];
  assignees: AssigneeStat[];
}

/** Gộp các endpoint dashboard cho 1 màn Báo cáo. */
export const getDashboardReport = (state: CrmDataState, actor: CrmActor, query: DashboardQuery = {}, now: Date = new Date()): DashboardReport => ({
  summary: getDashboardSummary(state, actor, query, state.settings.staleCustomerDays, now),
  byStatus: getDashboardBreakdown(state, actor, 'status', query),
  bySource: getDashboardBreakdown(state, actor, 'source', query),
  byProject: getDashboardBreakdown(state, actor, 'project', query),
  byArea: getDashboardBreakdown(state, actor, 'area', query),
  assignees: getAssigneeStats(state, actor, query),
});

const BREAKDOWN_SECTIONS: { title: string; pick: (report: DashboardReport) => BreakdownItem[] }[] = [
  { title: 'Theo tình trạng', pick: (report) => report.byStatus },
  { title: 'Theo nguồn khách', pick: (report) => report.bySource },
  { title: 'Theo dự án quan tâm', pick: (report) => report.byProject },
  { title: 'Theo khu vực', pick: (report) => report.byArea },
];

/** Bảng số liệu báo cáo dạng hàng CSV (X8 — xuất từ màn Báo cáo; chỉ số tổng hợp, không có dữ liệu cá nhân). */
export const buildDashboardReportRows = (report: DashboardReport, periodLabel: string): string[][] => {
  const rows: string[][] = [
    ['Báo cáo khách hàng CRM', periodLabel],
    [],
    ['Tổng khách', String(report.summary.totalCustomers)],
    [LIST_GROUP_LABELS.NOT_CONTACTED, String(report.summary.byListGroup.NOT_CONTACTED)],
    [LIST_GROUP_LABELS.INTERESTED, String(report.summary.byListGroup.INTERESTED)],
    ['Khách net', String(report.summary.byListGroup.NET)],
    ['Bỏ', String(report.summary.byListGroup.DROPPED)],
    ['Tiến độ trung bình (%)', String(report.summary.averageProgress)],
  ];
  BREAKDOWN_SECTIONS.forEach(({ title, pick }) => {
    rows.push([], [title, 'Số khách', 'Tỷ lệ (%)', 'Tiến độ TB (%)']);
    pick(report).forEach((item) => rows.push([item.key.label, String(item.count), String(item.percent), String(item.averageProgress)]));
  });
  rows.push([], ['Theo người chăm sóc', 'Phụ trách chính', 'Cùng chăm sóc', 'Số nhật ký', 'Tiến độ TB khách chính (%)']);
  report.assignees.forEach((row) =>
    rows.push([row.user.label, String(row.primaryCount), String(row.memberCount), String(row.careLogCount), String(row.averageProgress)]),
  );
  return rows;
};
