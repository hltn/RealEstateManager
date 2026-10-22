/**
 * "Việc hôm nay" (C3, C13, X5 — 05 §2.9 `GET /crm/daily-tasks`): TÍNH từ dữ liệu thật theo ngày thực (giờ VN),
 * không lưu nhãn cứng "Hôm nay"/"Trễ 2 ngày". Nguồn việc:
 * - APPOINTMENT: lịch hẹn SCHEDULED.
 * - FOLLOW_UP: bước tiếp theo (`nextAction.dueAt`) của nhật ký MỚI NHẤT có bước tiếp theo, chưa đánh dấu xong.
 * - OCCASION: sinh nhật/kỷ niệm trong N ngày tới (N = `settings.occasionLeadDays`), khách bật nhắc dịp.
 * - STALE_CUSTOMER: khách nhóm Chưa tiếp cận / Có quan tâm quá `settings.staleCustomerDays` ngày chưa có nhật ký.
 *
 * Phân nhóm: dueAt trước hôm nay -> Quá hạn; trong hôm nay -> Hôm nay; trong `upcomingDays` ngày tới -> Sắp tới.
 */
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import { getIdleDays, getListGroupOfStatus, getPrimaryUserId, isInCareTeam, isStaleCustomer } from '@crm/lib/customerRules';
import { maskPhoneDisplay } from '@crm/lib/phone';
import { toProjectLabel } from '@crm/lib/projectRules';
import { includesVietnamese } from '@crm/lib/text';
import { addDaysToDateKey, diffDateKeys, getVnTodayKey, toVnDateKey, vnDateTimeToIso } from '@crm/lib/dateTime';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { Customer, DailyTaskGroup } from '@crm/types/crm';
import type { CrmActor } from './access';
import { getAccessibleCustomers, matchesCustomerFilters, toStatusRef, toUserRef } from './queries';
import type { DailyTask, DailyTaskQuery } from './types';

const EXCERPT_LENGTH = 90;
/** Giờ hiển thị cho việc không có giờ cụ thể (dịp đặc biệt). */
const OCCASION_TIME = '08:00';

const APPOINTMENT_TYPE_TITLES: Record<string, string> = {
  SITE_VISIT: 'Dẫn khách xem nhà',
  MEETING: 'Gặp tư vấn',
  DEPOSIT: 'Ký cọc / HĐMB',
  CALLBACK: 'Gọi lại theo hẹn',
  OTHER: 'Lịch hẹn',
};

/** Nhóm theo ngày VN của `dueAt` so với hôm nay; ngoài cửa sổ "Sắp tới" -> null (không hiện). */
export const getTaskGroup = (dueAt: string, todayKey: string, upcomingDays: number): DailyTaskGroup | null => {
  const dayDiff = diffDateKeys(todayKey, toVnDateKey(dueAt));
  if (Number.isNaN(dayDiff)) return null;
  if (dayDiff < 0) return 'OVERDUE';
  if (dayDiff === 0) return 'TODAY';
  return dayDiff <= upcomingDays ? 'UPCOMING' : null;
};

/** Ngày gần nhất (từ hôm nay) của dịp hằng năm: (11, 15) -> "2026-11-15" hoặc năm sau nếu đã qua. 29/02 năm không nhuận -> 28/02. */
export const getNextOccurrenceKey = (month: number, day: number, todayKey: string): string => {
  const year = Number(todayKey.slice(0, 4));
  const build = (targetYear: number) => {
    const key = `${targetYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // addDaysToDateKey(key, 0) chuẩn hoá ngày không tồn tại (vd 29/02) sang ngày kế -> lùi 1 ngày cho đúng cuối tháng 2.
    const normalized = addDaysToDateKey(key, 0);
    return normalized === key ? key : addDaysToDateKey(normalized, -1);
  };
  const thisYear = build(year);
  return thisYear >= todayKey ? thisYear : build(year + 1);
};

const toTaskCustomer = (state: CrmDataState, customer: Customer): DailyTask['customer'] => ({
  id: customer.id,
  fullName: customer.fullName,
  phoneMasked: maskPhoneDisplay(customer.phone),
  status: toStatusRef(state.catalogs, customer.statusId),
  projects: customer.interestedProjectIds.map((id) => ({ id, label: toProjectLabel(state.catalogs.projects, id) })),
});

const getLastCareLog = (state: CrmDataState, customerId: string): DailyTask['lastCareLog'] => {
  const log = state.careLogs.filter((item) => item.customerId === customerId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (!log) return null;
  return { occurredAt: log.occurredAt, excerpt: log.content.length > EXCERPT_LENGTH ? `${log.content.slice(0, EXCERPT_LENGTH)}…` : log.content };
};

const GROUP_ORDER: Record<DailyTaskGroup, number> = { OVERDUE: 0, TODAY: 1, UPCOMING: 2 };

/**
 * `GET /crm/daily-tasks` (gộp cả 3 nhóm). `scope = 'mine'` (mặc định): việc của chính mình — lịch mình phụ trách,
 * bước tiếp theo mình ghi (hoặc mình là phụ trách chính khi nhật ký do hệ thống tạo), dịp đặc biệt của khách mình chăm sóc,
 * khách lâu chưa chăm sóc mà mình là phụ trách chính. `scope = 'team'` (chỉ Quản trị/Quản lý): mọi khách trong phạm vi.
 */
export const listDailyTasks = (state: CrmDataState, actor: CrmActor, query: DailyTaskQuery = {}, now: Date = new Date()): DailyTask[] => {
  const scope = query.scope === 'team' && (actor.role === 'ADMIN' || actor.role === 'MANAGER') ? 'team' : 'mine';
  const isMine = scope === 'mine';
  const todayKey = getVnTodayKey(now);
  const { upcomingDays, occasionLeadDays, staleCustomerDays } = state.settings;
  const customers = getAccessibleCustomers(state, actor);
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const tasks: DailyTask[] = [];

  const keyword = query.q?.trim() ?? '';
  const pushTask = (customer: Customer, task: Omit<DailyTask, 'customer' | 'group' | 'lastCareLog' | 'isPrimary'>) => {
    const group = getTaskGroup(task.dueAt, todayKey, upcomingDays);
    if (!group) return;
    // Tìm kiếm phía dữ liệu (05 `q`): tên/nội dung việc không dấu, hoặc như tìm khách (tên, SĐT các biến thể, email).
    if (keyword && !includesVietnamese(`${customer.fullName} ${task.title} ${task.suggestion}`, keyword) && !matchesCustomerFilters(customer, { q: keyword })) return;
    tasks.push({
      ...task,
      group,
      customer: toTaskCustomer(state, customer),
      lastCareLog: getLastCareLog(state, customer.id),
      isPrimary: getPrimaryUserId(customer.careTeam) === actor.userId,
    });
  };

  // 1. Lịch hẹn.
  state.appointments.forEach((appointment) => {
    const customer = customersById.get(appointment.customerId);
    if (!customer || appointment.status !== 'SCHEDULED') return;
    if (isMine && appointment.assigneeId !== actor.userId) return;
    pushTask(customer, {
      id: `task-apt-${appointment.id}`,
      kind: 'APPOINTMENT',
      dueAt: appointment.startAt,
      title: appointment.title || APPOINTMENT_TYPE_TITLES[appointment.type],
      suggestion: appointment.note,
      appointmentId: appointment.id,
      assignee: toUserRef(state.users, appointment.assigneeId),
    });
  });

  // 2. Bước tiếp theo của nhật ký mới nhất có hẹn (mỗi khách tối đa 1 việc).
  customers.forEach((customer) => {
    const log = state.careLogs
      .filter((item) => item.customerId === customer.id && item.nextAction?.dueAt)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const nextAction = log?.nextAction;
    if (!log || !nextAction?.dueAt || nextAction.completedAt || nextAction.appointmentId) return;
    const ownerId = nextAction.assigneeId ?? (log.source === 'SYSTEM' ? getPrimaryUserId(customer.careTeam) : log.authorId);
    if (isMine && ownerId !== actor.userId) return;
    pushTask(customer, {
      id: `task-follow-${log.id}`,
      kind: 'FOLLOW_UP',
      dueAt: nextAction.dueAt,
      title: nextAction.suggestion || 'Chăm sóc tiếp theo',
      suggestion: nextAction.suggestion,
      careLogId: log.id,
      assignee: toUserRef(state.users, ownerId),
    });
  });

  // 3. Dịp đặc biệt trong N ngày tới (gửi cho những người đang chăm sóc).
  customers.forEach((customer) => {
    if (!customer.shouldRemindOccasions || getListGroupOfStatus(state.catalogs.statuses, customer.statusId) === 'DROPPED') return;
    if (isMine && !isInCareTeam(customer.careTeam, actor.userId)) return;
    customer.occasions.forEach((occasion) => {
      const occurrenceKey = getNextOccurrenceKey(occasion.month, occasion.day, todayKey);
      const daysUntil = diffDateKeys(todayKey, occurrenceKey);
      if (daysUntil < 0 || daysUntil > occasionLeadDays) return;
      const field = PERSONA_FIELDS.find((item) => item.key === occasion.fieldKey);
      const label = field?.occasionLabel ?? field?.label ?? 'Dịp đặc biệt';
      pushTask(customer, {
        id: `task-occasion-${customer.id}-${occasion.fieldKey}-${occurrenceKey}`,
        kind: 'OCCASION',
        dueAt: vnDateTimeToIso(occurrenceKey, OCCASION_TIME),
        title: daysUntil === 0 ? `${label} hôm nay` : `${label} sau ${daysUntil} ngày`,
        suggestion: `Gửi lời chúc ${label.toLowerCase()} tới khách`,
        assignee: toUserRef(state.users, getPrimaryUserId(customer.careTeam)),
      });
    });
  });

  // 4. Khách lâu chưa chăm sóc (chỉ nhóm Chưa tiếp cận / Có quan tâm) — phụ trách chính nhận ưu tiên.
  customers.forEach((customer) => {
    if (!isStaleCustomer(customer, state.catalogs.statuses, staleCustomerDays, now)) return;
    const primaryId = getPrimaryUserId(customer.careTeam);
    if (isMine && primaryId !== actor.userId) return;
    const idleDays = getIdleDays(customer, now);
    pushTask(customer, {
      id: `task-stale-${customer.id}`,
      kind: 'STALE_CUSTOMER',
      dueAt: now.toISOString(),
      title: customer.lastCareLogAt ? `${idleDays} ngày chưa chăm sóc` : `Chưa có nhật ký chăm sóc sau ${idleDays} ngày`,
      suggestion: 'Liên hệ lại để cập nhật nhu cầu của khách',
      assignee: toUserRef(state.users, primaryId),
    });
  });

  return tasks.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.dueAt.localeCompare(b.dueAt));
};

/** `GET /crm/daily-tasks/summary` */
export const getDailyTaskSummary = (tasks: readonly DailyTask[]): Record<DailyTaskGroup, number> => ({
  OVERDUE: tasks.filter((task) => task.group === 'OVERDUE').length,
  TODAY: tasks.filter((task) => task.group === 'TODAY').length,
  UPCOMING: tasks.filter((task) => task.group === 'UPCOMING').length,
});
