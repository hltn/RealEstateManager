/**
 * Truy vấn đọc của lớp dữ liệu CRM — mỗi hàm ứng với 1 endpoint GET/lookup của tài liệu 05, chạy trên state mock.
 * Hàm thuần: (state, actor, tham số) -> response đúng shape 05 §1.6. Mọi truy vấn khách đều lọc theo phạm vi quyền.
 *
 * [Prototype] Đây là phần "máy chủ giả" đọc dữ liệu: app chính gọi API thật (`api/http/*`) rồi mapper đổi sang cùng các kiểu view
 * (`api/types.ts`), prototype tính trực tiếp từ store nên UI nhận ĐÚNG shape như app chính.
 */
import { PERSONA_FIELDS, PERSONA_GROUP_LABELS } from '@crm/data/personaFields';
import {
  CRITERIA_KEYS,
  findPersonaValue,
  getListGroupOfStatus,
  getMissingPersonaFields,
  getPersonaText,
  getPrimaryUserId,
  getProgressPercent,
  isInCareTeam,
  maskNationalId,
} from '@crm/lib/customerRules';
import { toVnDateKey } from '@crm/lib/dateTime';
import { toProjectLabel } from '@crm/lib/projectRules';
import { getPhoneSearchVariants, maskPhoneDisplay, normalizePhone } from '@crm/lib/phone';
import { parseCustomerCode } from '@crm/lib/customerCode';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { CustomerFilters } from '@crm/types/app';
import type { AdminUser, Appointment, CareLog, CriterionKey, CrmCatalogs, CrmUser, Customer, PersonaGroupCode, Ref, StatusRef, TeamMember, UserRef } from '@crm/types/crm';
import { canAccessCustomer, getCustomerPermissions, teamIdsOfUser, type CrmActor } from './access';
import type {
  AppointmentListQuery,
  AppointmentView,
  CareLogView,
  CareTeamInvitee,
  CareTeamInviteeQuery,
  CustomerDetail,
  CustomerAssignee,
  CustomerAssigneeQuery,
  CustomerListItem,
  DeletedCustomerItem,
  DeletedCustomerQuery,
  CustomerListQuery,
  CustomerPersonaView,
  CustomerSort,
  HistoryEntry,
  ListCounts,
  NationalIdViewEntry,
  Paginated,
} from './types';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_CUSTOMER_SORT: CustomerSort = '-lastUpdatedAt';

// ---------------------------------------------------------------------------
// Chuyển đổi tham chiếu (RefResolver — 04 §2.2)
// ---------------------------------------------------------------------------

export const toUserRef = (users: readonly CrmUser[], userId: string | null | undefined): UserRef | null => {
  if (!userId) return null;
  const user = users.find((item) => item.id === userId);
  return { id: userId, displayName: user?.displayName ?? (userId === 'system' ? 'Hệ thống' : 'Không rõ') };
};

const requireUserRef = (users: readonly CrmUser[], userId: string): UserRef => toUserRef(users, userId) ?? { id: userId, displayName: 'Không rõ' };

export const toStatusRef = (catalogs: CrmCatalogs, statusId: string): StatusRef => {
  const status = catalogs.statuses.find((item) => item.id === statusId);
  return status
    ? { id: status.id, label: status.label, code: status.code, listGroup: status.listGroup, tone: status.tone }
    : { id: statusId, label: 'Không rõ', code: 'UNKNOWN', listGroup: 'NOT_CONTACTED', tone: 'gray' };
};

const toProjectRefs = (catalogs: CrmCatalogs, projectIds: readonly string[]): Ref[] =>
  projectIds.map((id) => ({ id, label: toProjectLabel(catalogs.projects, id) }));

/** Người phụ trách chính kèm `isLocked` (tài khoản đã khóa vẫn hiển thị, UI gắn nhãn "đã khóa"). */
const toPrimaryAssignee = (users: readonly CrmUser[], userId: string | null): (UserRef & { isLocked: boolean }) | null => {
  const ref = toUserRef(users, userId);
  return ref ? { ...ref, isLocked: users.find((item) => item.id === userId)?.isActive === false } : null;
};

export const toListItem = (state: CrmDataState, customer: Customer): CustomerListItem => {
  const { catalogs, users } = state;
  const source = customer.sourceId ? catalogs.leadSources.find((item) => item.id === customer.sourceId) : undefined;
  const area = customer.areaId ? catalogs.areas.find((item) => item.id === customer.areaId) : undefined;
  return {
    id: customer.id,
    fullName: customer.fullName,
    customerCode: customer.customerCode ?? null,
    // Khách chưa có SĐT -> null (không phải chuỗi rỗng) để UI ẩn dòng SĐT.
    phoneMasked: customer.phone ? maskPhoneDisplay(customer.phone) : null,
    status: toStatusRef(catalogs, customer.statusId),
    source: source ? { id: source.id, label: source.label } : null,
    projects: toProjectRefs(catalogs, customer.interestedProjectIds),
    area: area ? { id: area.id, label: area.name } : null,
    tags: customer.tagIds.flatMap((id) => {
      const tag = catalogs.tags.find((item) => item.id === id);
      return tag ? [{ id: tag.id, label: tag.name }] : [];
    }),
    progress: getProgressPercent(customer.criteria),
    criteriaDone: Object.fromEntries(CRITERIA_KEYS.map((key) => [key, customer.criteria[key].isDone])) as Record<CriterionKey, boolean>,
    primaryAssignee: toPrimaryAssignee(users, customer.primaryAssigneeId),
    careTeamSize: customer.careTeam.length,
    nextAppointmentAt: customer.nextAppointmentAt,
    lastCareLogAt: customer.lastCareLogAt,
    lastUpdatedAt: customer.lastUpdatedAt,
    createdAt: customer.createdAt,
    personaCompleteness: customer.personaCompleteness,
  };
};

// ---------------------------------------------------------------------------
// Phạm vi + bộ lọc (X3)
// ---------------------------------------------------------------------------

export const getAccessibleCustomers = (state: CrmDataState, actor: CrmActor): Customer[] =>
  state.customers.filter((customer) => canAccessCustomer(actor, customer, state.users));

const hasAny = (values: readonly string[] | undefined): values is string[] => Boolean(values && values.length > 0);

/**
 * Từ khoá SĐT: bỏ ký tự phân cách `[\s+().-]`; còn lại toàn chữ số (>= 3) thì so theo chữ số, gồm cả các biến thể
 * "+84912345678" / "0912-345-678" / "0912.345.678" (qua `getPhoneSearchVariants`).
 */
/**
 * Từ khóa mã khách (v1.0.5): `KH-12`, `kh000123`, `kh 123` (không phân biệt hoa/thường, bỏ khoảng trắng). Khớp khi mã bằng dạng đệm 6 số
 * hoặc bắt đầu bằng phần đã gõ. Từ khóa TOÀN SỐ vẫn là SĐT; muốn tìm mã phải gõ `KH`.
 */
const matchesCodeKeyword = (customerCode: string | null | undefined, rawKeyword: string): boolean => {
  const typed = /^kh-?(\d+)$/i.exec(rawKeyword.replace(/\s/g, ''));
  if (!typed || !customerCode) return false;
  const digits = typed[1];
  const sequence = parseCustomerCode(customerCode);
  return sequence !== null && (sequence === Number(digits) || customerCode.slice(3).startsWith(digits));
};

const matchesPhoneKeyword = (searchText: string, rawKeyword: string): boolean => {
  const compact = rawKeyword.replace(/[\s+().-]/g, '');
  if (!/^\d{3,}$/.test(compact)) return false;
  const variants = new Set([compact, ...(normalizePhone(rawKeyword) ? getPhoneSearchVariants(rawKeyword) : [])]);
  return [...variants].some((variant) => variant.length >= 3 && searchText.includes(variant));
};

/** So khớp 1 khách với bộ lọc (không gồm `listGroup`). Tìm kiếm không dấu qua `searchText` (04 §3.2.3). */
export const matchesCustomerFilters = (customer: Customer, filters: Partial<CustomerFilters>): boolean => {
  const keyword = normalizeVietnamese(filters.q ?? '');
  if (
    keyword &&
    !customer.searchText.includes(keyword) &&
    !matchesPhoneKeyword(customer.searchText, filters.q ?? '') &&
    !matchesCodeKeyword(customer.customerCode, filters.q ?? '')
  ) {
    return false;
  }
  if (hasAny(filters.statusIds) && !filters.statusIds.includes(customer.statusId)) return false;
  if (hasAny(filters.sourceIds) && (!customer.sourceId || !filters.sourceIds.includes(customer.sourceId))) return false;
  if (hasAny(filters.projectIds) && !customer.interestedProjectIds.some((id) => filters.projectIds?.includes(id))) return false;
  if (hasAny(filters.areaIds) && (!customer.areaId || !filters.areaIds.includes(customer.areaId))) return false;
  if (hasAny(filters.assigneeIds) && !filters.assigneeIds.some((userId) => isInCareTeam(customer.careTeam, userId))) return false;
  if (hasAny(filters.primaryAssigneeIds) && (!customer.primaryAssigneeId || !filters.primaryAssigneeIds.includes(customer.primaryAssigneeId))) return false;
  if (filters.progress && filters.progress.length > 0 && !filters.progress.includes(getProgressPercent(customer.criteria))) return false;
  const updatedKey = toVnDateKey(customer.lastUpdatedAt);
  if (filters.updatedFrom && updatedKey < filters.updatedFrom) return false;
  if (filters.updatedTo && updatedKey > filters.updatedTo) return false;
  if (filters.occupation?.trim()) {
    const occupation = normalizeVietnamese(getPersonaText(customer.persona, 'occupation'));
    if (!occupation.includes(normalizeVietnamese(filters.occupation))) return false;
  }
  if (hasAny(filters.tagIds) && !filters.tagIds.every((tagId) => customer.tagIds.includes(tagId))) return false;
  return true;
};

const compareNullableIso = (first: string | null, second: string | null): number => {
  if (first === second) return 0;
  if (!first) return 1;
  if (!second) return -1;
  return first.localeCompare(second);
};

/** Sắp xếp theo whitelist 05 §2.3 (mặc định `-lastUpdatedAt`; giá trị rỗng luôn xuống cuối). */
export const sortCustomers = (customers: Customer[], sort: CustomerSort = DEFAULT_CUSTOMER_SORT): Customer[] => {
  const isDescending = sort.startsWith('-');
  const field = (isDescending ? sort.slice(1) : sort) as CustomerSort;
  const direction = isDescending ? -1 : 1;
  return [...customers].sort((first, second) => {
    switch (field) {
      case 'fullName':
        return direction * first.fullName.localeCompare(second.fullName, 'vi');
      case 'progress':
        return direction * (getProgressPercent(first.criteria) - getProgressPercent(second.criteria));
      case 'personaCompleteness':
        return direction * (first.personaCompleteness - second.personaCompleteness);
      case 'createdAt':
        return direction * first.createdAt.localeCompare(second.createdAt);
      case 'nextAppointmentAt':
      case 'lastCareLogAt': {
        const firstValue = first[field];
        const secondValue = second[field];
        if (!firstValue || !secondValue) return compareNullableIso(firstValue, secondValue);
        return direction * firstValue.localeCompare(secondValue);
      }
      default:
        return direction * first.lastUpdatedAt.localeCompare(second.lastUpdatedAt);
    }
  });
};

const clampLimit = (limit: number | undefined): number => Math.min(MAX_PAGE_LIMIT, Math.max(1, limit ?? DEFAULT_PAGE_LIMIT));

/** Lọc khách (gồm listGroup + customerIds) theo phạm vi quyền — dùng chung danh sách, xuất CSV, báo cáo. */
export const queryCustomers = (state: CrmDataState, actor: CrmActor, query: CustomerListQuery): Customer[] => {
  const customers = getAccessibleCustomers(state, actor).filter(
    (customer) =>
      (!query.customerIds || query.customerIds.includes(customer.id)) &&
      (!query.listGroup || query.listGroup === 'ALL' || getListGroupOfStatus(state.catalogs.statuses, customer.statusId) === query.listGroup) &&
      matchesCustomerFilters(customer, query),
  );
  return sortCustomers(customers, query.sort);
};

/** `GET /crm/customers` */
export const listCustomers = (state: CrmDataState, actor: CrmActor, query: CustomerListQuery = {}): Paginated<CustomerListItem> => {
  const matched = queryCustomers(state, actor, query);
  const limit = clampLimit(query.limit);
  const totalPages = Math.max(1, Math.ceil(matched.length / limit));
  const page = Math.min(totalPages, Math.max(1, query.page ?? 1));
  return {
    data: matched.slice((page - 1) * limit, page * limit).map((customer) => toListItem(state, customer)),
    meta: { total: matched.length, page, limit, totalPages },
  };
};

/** `GET /crm/customers/list-counts` — cùng bộ lọc trừ `listGroup` -> số trên tab khớp số dòng. */
export const getListCounts = (state: CrmDataState, actor: CrmActor, query: CustomerListQuery = {}): ListCounts => {
  const matched = queryCustomers(state, actor, { ...query, listGroup: 'ALL' });
  const counts: ListCounts = { NOT_CONTACTED: 0, INTERESTED: 0, NET: 0, DROPPED: 0, ALL: matched.length, byStatus: [] };
  const byStatus = new Map<string, number>();
  matched.forEach((customer) => {
    counts[getListGroupOfStatus(state.catalogs.statuses, customer.statusId)] += 1;
    byStatus.set(customer.statusId, (byStatus.get(customer.statusId) ?? 0) + 1);
  });
  counts.byStatus = [...byStatus.entries()].map(([statusId, count]) => ({ statusId, count }));
  return counts;
};

/** Khách theo id CHỈ khi trong phạm vi (ngoài phạm vi = không tồn tại, như 404). */
export const findAccessibleCustomer = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined): Customer | null => {
  if (!customerId) return null;
  const customer = state.customers.find((item) => item.id === customerId);
  return customer && canAccessCustomer(actor, customer, state.users) ? customer : null;
};

/** Gợi ý bước tiếp theo thật: bước tiếp theo đang chờ của nhật ký mới nhất + gợi ý của kết quả liên hệ. */
const getNextActionSuggestions = (state: CrmDataState, customerId: string): string[] => {
  const logs = state.careLogs.filter((log) => log.customerId === customerId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const pending = logs.find((log) => log.nextAction && !log.nextAction.completedAt && log.nextAction.suggestion.trim());
  const latestResult = logs[0]?.contactResultId ? state.catalogs.contactResults.find((item) => item.id === logs[0].contactResultId) : undefined;
  return [...new Set([pending?.nextAction?.suggestion.trim(), latestResult?.suggestionText.trim()].filter((text): text is string => Boolean(text)))];
};

/** `GET /crm/customers/:id` */
export const getCustomer = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined): CustomerDetail | null => {
  const customer = findAccessibleCustomer(state, actor, customerId);
  if (!customer) return null;
  const { users } = state;
  return {
    ...toListItem(state, customer),
    createdAt: customer.createdAt,
    email: customer.email,
    criteria: Object.fromEntries(
      CRITERIA_KEYS.map((key) => [key, { ...customer.criteria[key], updatedBy: toUserRef(users, customer.criteria[key].updatedBy) }]),
    ) as CustomerDetail['criteria'],
    careTeam: customer.careTeam.map((member) => {
      const user = users.find((item) => item.id === member.userId);
      return {
        user: {
          id: member.userId,
          displayName: user?.displayName ?? 'Không rõ',
          fullName: user?.fullName ?? 'Không rõ',
          jobTitle: user?.jobTitle ?? '',
          avatarUrl: user?.avatarUrl,
          role: user?.role,
          isLocked: user ? !user.isActive : undefined,
        },
        role: member.role,
        addedAt: member.addedAt,
        addedBy: requireUserRef(users, member.addedBy),
      };
    }),
    nationalIdMasked: customer.hasNationalId ? maskNationalId(customer.nationalIdLast4) : null,
    hasNationalId: customer.hasNationalId,
    lastUpdatedBy: requireUserRef(users, customer.lastUpdatedBy),
    createdBy: requireUserRef(users, customer.createdBy),
    createdVia: customer.createdVia,
    nextActionSuggestions: getNextActionSuggestions(state, customer.id),
    permissions: getCustomerPermissions(actor, customer, { users, isDropped: getListGroupOfStatus(state.catalogs.statuses, customer.statusId) === 'DROPPED' }),
    version: customer.version,
  };
};

/** `GET /crm/customers/:id/persona` */
export const getCustomerPersona = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined): CustomerPersonaView | null => {
  const customer = findAccessibleCustomer(state, actor, customerId);
  if (!customer) return null;
  const groupOrder = Object.keys(PERSONA_GROUP_LABELS) as PersonaGroupCode[];
  return {
    groups: groupOrder
      .map((code) => ({
        code,
        label: PERSONA_GROUP_LABELS[code],
        fields: PERSONA_FIELDS.filter((field) => field.isActive && field.groupCode === code).map((field) => {
          const value = findPersonaValue(customer.persona, field.key) ?? null;
          return {
            fieldKey: field.key,
            label: field.label,
            groupCode: field.groupCode,
            type: field.type,
            value,
            source: value?.source ?? null,
            updatedAt: value?.updatedAt ?? null,
            updatedBy: toUserRef(state.users, value?.updatedBy),
          };
        }),
      }))
      .filter((group) => group.fields.length > 0),
    completeness: customer.personaCompleteness,
    missingSuggestions: getMissingPersonaFields(customer.persona, PERSONA_FIELDS).map((field) => ({
      fieldKey: field.key,
      label: field.label,
      groupCode: field.groupCode,
    })),
    values: customer.persona,
    version: customer.version,
  };
};

/** Người gọi còn quyền sửa/xóa nhật ký: tác giả trong `careLogEditWindowHours` giờ, hoặc Quản trị/Quản lý (đã trong phạm vi xem). */
const canEditCareLog = (state: CrmDataState, actor: CrmActor, log: CareLog, now: Date): boolean => {
  if (log.source !== 'MANUAL') return false;
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return true;
  const windowMs = state.settings.careLogEditWindowHours * 60 * 60 * 1000;
  return log.authorId === actor.userId && now.getTime() - new Date(log.createdAt ?? log.occurredAt).getTime() <= windowMs;
};

const toCareLogView = (state: CrmDataState, actor: CrmActor, log: CareLog, primaryUserId: string | null, now: Date): CareLogView => {
  const result = log.contactResultId ? state.catalogs.contactResults.find((item) => item.id === log.contactResultId) : undefined;
  const user = state.users.find((item) => item.id === log.authorId);
  return {
    id: log.id,
    customerId: log.customerId,
    author: { id: log.authorId, displayName: user?.displayName ?? log.authorName },
    isPrimaryAuthor: primaryUserId !== null && log.authorId === primaryUserId,
    occurredAt: log.occurredAt,
    content: log.content,
    contactChannel: log.contactChannel,
    contactResult: result ? { id: result.id, label: result.label } : null,
    nextAction: log.nextAction,
    source: log.source,
    images: log.images ?? [],
    attachmentIds: [],
    editedAt: log.editedAt ?? null,
    canEdit: canEditCareLog(state, actor, log, now),
  };
};

/** `GET /crm/customers/:id/care-logs` — mới nhất trước. */
export const listCareLogs = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined, now: Date = new Date()): CareLogView[] => {
  const customer = findAccessibleCustomer(state, actor, customerId);
  if (!customer) return [];
  const primaryUserId = getPrimaryUserId(customer.careTeam);
  return state.careLogs
    .filter((log) => log.customerId === customer.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((log) => toCareLogView(state, actor, log, primaryUserId, now));
};

/**
 * Người gọi được xóa lịch: Quản trị/Quản lý (lịch của khách trong phạm vi xem) hoặc người tạo lịch (Nhân viên: lịch do mình tạo).
 */
const canDeleteAppointment = (actor: CrmActor, appointment: Appointment): boolean => actor.role === 'ADMIN' || actor.role === 'MANAGER' || appointment.createdBy === actor.userId;

export const toAppointmentView = (state: CrmDataState, actor: CrmActor, appointment: Appointment, customer: Customer): AppointmentView => ({
  id: appointment.id,
  customer: {
    id: customer.id,
    fullName: customer.fullName,
    phoneMasked: customer.phone ? maskPhoneDisplay(customer.phone) : null,
    status: toStatusRef(state.catalogs, customer.statusId),
    projects: toProjectRefs(state.catalogs, customer.interestedProjectIds),
  },
  type: appointment.type,
  title: appointment.title,
  startAt: appointment.startAt,
  endAt: appointment.endAt,
  location: appointment.location,
  note: appointment.note,
  project: appointment.projectId ? { id: appointment.projectId, label: toProjectLabel(state.catalogs.projects, appointment.projectId) } : null,
  assignee: requireUserRef(state.users, appointment.assigneeId),
  remindBeforeMinutes: appointment.remindBeforeMinutes,
  status: appointment.status,
  completedAt: appointment.completedAt,
  outcome: appointment.outcome ?? null,
  createdBy: requireUserRef(state.users, appointment.createdBy),
  version: appointment.version ?? 1,
  canDelete: canDeleteAppointment(actor, appointment),
});

/**
 * `GET /crm/appointments` — lịch của khách trong phạm vi, sắp theo `startAt`. Bỏ lịch đã huỷ (trừ khi lọc `status = CANCELED`).
 * [Prototype] Hỗ trợ thêm `projectId`, `assigneeIds`, `types` như app chính.
 */
export const listAppointments = (state: CrmDataState, actor: CrmActor, query: AppointmentListQuery = {}): AppointmentView[] => {
  const customersById = new Map(getAccessibleCustomers(state, actor).map((customer) => [customer.id, customer]));
  return state.appointments
    .filter((appointment) => {
      if (appointment.status === 'CANCELED' && query.status !== 'CANCELED') return false;
      if (!customersById.has(appointment.customerId)) return false;
      if (query.customerId && appointment.customerId !== query.customerId) return false;
      if (query.status && appointment.status !== query.status) return false;
      if (query.projectId && appointment.projectId !== query.projectId) return false;
      if (query.assigneeIds && query.assigneeIds.length > 0 && !query.assigneeIds.includes(appointment.assigneeId)) return false;
      if (query.types && query.types.length > 0 && !query.types.includes(appointment.type)) return false;
      const dateKey = toVnDateKey(appointment.startAt);
      if (query.from && dateKey < query.from) return false;
      if (query.to && dateKey > query.to) return false;
      return true;
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((appointment) => toAppointmentView(state, actor, appointment, customersById.get(appointment.customerId) as Customer));
};

/** `GET /crm/customers/:id/histories` — mục xem CCCD chỉ trả cho Quản trị/Quản lý. */
export const listHistories = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined): HistoryEntry[] => {
  const customer = findAccessibleCustomer(state, actor, customerId);
  if (!customer) return [];
  const canSeeIdViews = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  return state.changeLogs
    .filter((log) => log.customerId === customer.id && (canSeeIdViews || (log.action !== 'NATIONAL_ID_VIEWED' && log.action !== 'PHONE_VIEWED')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((log) => ({
      id: log.id,
      action: log.action,
      actor: { id: log.actorId, displayName: log.actorName },
      actorRole: log.actorRole,
      changes: log.changes,
      reason: log.reason,
      source: log.source,
      createdAt: log.createdAt,
    }));
};

/** `GET /crm/customers/:id/national-id-views` — chỉ Quản trị, Quản lý. */
export const listNationalIdViews = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined): NationalIdViewEntry[] => {
  const customer = findAccessibleCustomer(state, actor, customerId);
  if (!customer || (actor.role !== 'ADMIN' && actor.role !== 'MANAGER')) return [];
  return state.nationalIdViews
    .filter((view) => view.customerId === customer.id)
    .sort((a, b) => b.viewedAt.localeCompare(a.viewedAt))
    .map((view) => ({ viewer: requireUserRef(state.users, view.viewerId), viewedAt: view.viewedAt, purpose: 'VIEW' }));
};

/** Tài khoản MANAGER/STAFF đang hoạt động, chưa khóa (backend: `status: ACTIVE`, `roles` chứa MANAGER hoặc STAFF). */
const isInvitableAccount = (user: CrmUser & { roles?: readonly string[] }): boolean =>
  user.isActive && (user.roles ?? [user.role]).some((role) => role === 'MANAGER' || role === 'STAFF');

const CARE_TEAM_INVITEE_MAX_LIMIT = 20;
const CUSTOMER_ASSIGNEE_MAX_LIMIT = 100;
const SEARCH_TEXT_MAX_LENGTH = 50;

const paginate = <T>(items: readonly T[], page: number | undefined, limit: number): Paginated<T> => {
  const totalPages = Math.max(1, Math.ceil(items.length / limit));
  const current = Math.min(totalPages, Math.max(1, page ?? 1));
  return { data: items.slice((current - 1) * limit, current * limit), meta: { total: items.length, page: current, limit, totalPages } };
};

const teamsOfUser = (state: CrmDataState, user: AdminUser): Ref[] =>
  teamIdsOfUser(user).flatMap((teamId) => {
    const team = state.teams.find((item) => item.id === teamId);
    return team ? [{ id: team.id, label: team.name }] : [];
  });

const matchesDisplayName = (user: CrmUser, q: string | undefined): boolean => {
  const keyword = normalizeVietnamese((q ?? '').slice(0, SEARCH_TEXT_MAX_LENGTH).trim());
  return !keyword || normalizeVietnamese(user.displayName).includes(keyword);
};

/**
 * `GET /crm/care-team-invitees` (v1.0.5, FR-13, 14) — người có thể mời vào nhóm chăm sóc. CHỈ id, tên hiển thị, tên nhóm
 * (không email/SĐT/vai trò). Có `customerId`: người gọi phải là Quản trị/Quản lý hoặc PRIMARY của khách đó và kết quả loại người đã
 * trong nhóm. Không `customerId`: chỉ Quản trị/Quản lý (thao tác hàng loạt). Loại chính người gọi; sắp theo tên hiển thị.
 * Không đủ quyền/khách ngoài phạm vi -> trang rỗng (backend 403/404).
 */
export const listCareTeamInvitees = (state: CrmDataState, actor: CrmActor, query: CareTeamInviteeQuery = {}): Paginated<CareTeamInvitee> => {
  const limit = Math.min(CARE_TEAM_INVITEE_MAX_LIMIT, Math.max(1, query.limit ?? CARE_TEAM_INVITEE_MAX_LIMIT));
  const isAdminOrManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  let excludedIds = new Set<string>();
  if (query.customerId) {
    const customer = findAccessibleCustomer(state, actor, query.customerId);
    if (!customer || !(isAdminOrManager || getPrimaryUserId(customer.careTeam) === actor.userId)) return paginate([], 1, limit);
    excludedIds = new Set(customer.careTeam.map((member) => member.userId));
  } else if (!isAdminOrManager) {
    return paginate([], 1, limit);
  }
  const invitees = state.users
    .filter((user) => isInvitableAccount(user) && user.id !== actor.userId && !excludedIds.has(user.id) && matchesDisplayName(user, query.q))
    .sort((first, second) => first.displayName.localeCompare(second.displayName, 'vi'))
    .map((user) => ({ id: user.id, displayName: user.displayName, teamNames: teamsOfUser(state, user).map((team) => team.label) }));
  return paginate(invitees, query.page, limit);
};

/**
 * `GET /crm/customer-assignees` (v1.0.5, FR-09, 18) — nguồn ô lọc "Người phụ trách": những người XUẤT HIỆN trong `careTeam` của các khách
 * người gọi thấy (bỏ khách xóa mềm), gồm cả tài khoản đã khóa (để lọc được khách cũ của họ). Áp cho mọi vai trò; không lọc trạng thái/role.
 */
export const listCustomerAssignees = (state: CrmDataState, actor: CrmActor, query: CustomerAssigneeQuery = {}): Paginated<CustomerAssignee> => {
  const limit = Math.min(CUSTOMER_ASSIGNEE_MAX_LIMIT, Math.max(1, query.limit ?? CUSTOMER_ASSIGNEE_MAX_LIMIT));
  const visibleIds = new Set(
    getAccessibleCustomers(state, actor)
      .filter((customer) => !customer.deletedAt)
      .flatMap((customer) => customer.careTeam.map((member) => member.userId)),
  );
  const assignees = state.users
    .filter((user) => visibleIds.has(user.id) && (!query.teamId || teamIdsOfUser(user).includes(query.teamId)) && matchesDisplayName(user, query.q))
    .sort((first, second) => first.displayName.localeCompare(second.displayName, 'vi'))
    .map((user): CustomerAssignee => {
      const teams = teamsOfUser(state, user);
      return { id: user.id, displayName: user.displayName, role: user.role, team: teams[0] ?? null, teams, isLocked: !user.isActive };
    });
  return paginate(assignees, query.page, limit);
};

// ---------------------------------------------------------------------------
// [Prototype] Khách đã xóa mềm + thành viên nhóm (Sửa đổi D, thành viên nhóm)
// ---------------------------------------------------------------------------

const DELETED_PAGE_LIMIT = 20;

/**
 * `GET /crm/deleted-customers` (chỉ Quản trị) — khách đã xóa mềm, mới xóa trước; tìm theo tên/SĐT không dấu. `deleteReason` null khi đã
 * ẩn danh hóa. Người gọi không phải Quản trị -> rỗng (backend 403; màn đã chặn bằng `canViewDeletedCustomers`).
 */
export const listDeletedCustomers = (state: CrmDataState, actor: CrmActor, query: DeletedCustomerQuery = {}): Paginated<DeletedCustomerItem> => {
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit ?? DELETED_PAGE_LIMIT));
  const keyword = normalizeVietnamese(query.q ?? '');
  const matched =
    actor.role !== 'ADMIN'
      ? []
      : state.customers
          .filter((customer) => customer.deletedAt && (!keyword || customer.searchText.includes(keyword) || matchesPhoneKeyword(customer.searchText, query.q ?? '')))
          .sort((first, second) => (second.deletedAt ?? '').localeCompare(first.deletedAt ?? ''));
  const totalPages = Math.max(1, Math.ceil(matched.length / limit));
  const page = Math.min(totalPages, Math.max(1, query.page ?? 1));
  return {
    data: matched.slice((page - 1) * limit, page * limit).map((customer) => ({
      ...toListItem(state, customer),
      deletedAt: customer.deletedAt as string,
      deletedBy: toUserRef(state.users, customer.deletedBy),
      anonymizedAt: customer.anonymizedAt ?? null,
      deleteReason: customer.anonymizedAt ? null : (customer.deleteReason ?? null),
      purgeInProgress: Boolean(customer.isPurgeInProgress),
    })),
    meta: { total: matched.length, page, limit, totalPages },
  };
};

const TEAM_MEMBER_PAGE_LIMIT = 10;

/** Thành viên của một nhóm = tài khoản có `teamIds` chứa nhóm (không phải `managerIds`); `isManager` theo `team.managerIds`. Sắp theo tên. */
export const listTeamMembers = (state: CrmDataState, teamId: string, query: { page?: number; limit?: number; q?: string } = {}): Paginated<TeamMember> | null => {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return null;
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit ?? TEAM_MEMBER_PAGE_LIMIT));
  const keyword = normalizeVietnamese(query.q ?? '');
  const matched = state.users
    .filter((user) => teamIdsOfUser(user).includes(teamId) && (!keyword || normalizeVietnamese(user.displayName).includes(keyword)))
    .sort((first, second) => first.displayName.localeCompare(second.displayName, 'vi'));
  const totalPages = Math.max(1, Math.ceil(matched.length / limit));
  const page = Math.min(totalPages, Math.max(1, query.page ?? 1));
  return {
    data: matched.slice((page - 1) * limit, page * limit).map((user) => ({
      id: user.id,
      displayName: user.displayName,
      role: user.roles[0] ?? user.role,
      roles: user.roles,
      isActive: user.isActive,
      isManager: team.managerIds.includes(user.id),
    })),
    meta: { total: matched.length, page, limit, totalPages },
  };
};

/** Số thành viên của từng nhóm (cột "N thành viên" ở Cài đặt > Nhóm). */
export const countTeamMembers = (users: readonly AdminUser[], teamId: string): number => users.filter((user) => teamIdsOfUser(user).includes(teamId)).length;

/** Quản trị xem mọi nhóm; Quản lý xem nhóm mình quản lý; Nhân viên không xem danh sách thành viên. */
export const canViewTeamMembers = (actor: CrmActor, teamId: string): boolean => actor.role === 'ADMIN' || (actor.role === 'MANAGER' && actor.managedTeamIds.includes(teamId));
