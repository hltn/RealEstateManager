/**
 * Truy vấn đọc của lớp dữ liệu CRM — mỗi hàm ứng với 1 endpoint GET/lookup của tài liệu 05, chạy trên state mock.
 * Hàm thuần: (state, actor, tham số) -> response đúng shape 05 §1.6. Mọi truy vấn khách đều lọc theo phạm vi quyền.
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
import { normalizeVietnamese } from '@crm/lib/text';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { CustomerFilters } from '@crm/types/app';
import type { Appointment, CareLog, CriterionKey, CrmCatalogs, CrmUser, Customer, PersonaGroupCode, Ref, StatusRef, UserRef } from '@crm/types/crm';
import { canAccessCustomer, getCustomerPermissions, type CrmActor } from './access';
import type {
  AppointmentListQuery,
  AppointmentView,
  AssignableUser,
  CareLogView,
  CareTeamRequestView,
  CustomerDetail,
  CustomerListItem,
  CustomerListQuery,
  CustomerPersonaView,
  CustomerSort,
  HistoryEntry,
  ListCounts,
  NationalIdViewEntry,
  Paginated,
  PhoneLookupResult,
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

const toListItem = (state: CrmDataState, customer: Customer): CustomerListItem => {
  const { catalogs, users } = state;
  const source = customer.sourceId ? catalogs.leadSources.find((item) => item.id === customer.sourceId) : undefined;
  const area = customer.areaId ? catalogs.areas.find((item) => item.id === customer.areaId) : undefined;
  return {
    id: customer.id,
    fullName: customer.fullName,
    phoneMasked: maskPhoneDisplay(customer.phone),
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
    primaryAssignee: toUserRef(users, customer.primaryAssigneeId),
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
const matchesPhoneKeyword = (searchText: string, rawKeyword: string): boolean => {
  const compact = rawKeyword.replace(/[\s+().-]/g, '');
  if (!/^\d{3,}$/.test(compact)) return false;
  const variants = new Set([compact, ...(normalizePhone(rawKeyword) ? getPhoneSearchVariants(rawKeyword) : [])]);
  return [...variants].some((variant) => variant.length >= 3 && searchText.includes(variant));
};

/** So khớp 1 khách với bộ lọc (không gồm `listGroup`). Tìm kiếm không dấu qua `searchText` (04 §3.2.3). */
export const matchesCustomerFilters = (customer: Customer, filters: Partial<CustomerFilters>): boolean => {
  const keyword = normalizeVietnamese(filters.q ?? '');
  if (keyword && !customer.searchText.includes(keyword) && !matchesPhoneKeyword(customer.searchText, filters.q ?? '')) return false;
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
        },
        role: member.role,
        addedAt: member.addedAt,
        addedBy: requireUserRef(users, member.addedBy),
      };
    }),
    nationalIdMasked: customer.hasNationalId ? maskNationalId(customer.nationalIdLast4) : null,
    hasNationalId: customer.hasNationalId,
    notes: customer.notes,
    shouldRemindOccasions: customer.shouldRemindOccasions,
    lastUpdatedBy: requireUserRef(users, customer.lastUpdatedBy),
    createdBy: requireUserRef(users, customer.createdBy),
    createdVia: customer.createdVia,
    nextActionSuggestions: getNextActionSuggestions(state, customer.id),
    permissions: getCustomerPermissions(actor, customer),
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
  };
};

const toCareLogView = (state: CrmDataState, log: CareLog, primaryUserId: string | null): CareLogView => {
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
  };
};

/** `GET /crm/customers/:id/care-logs` — mới nhất trước. */
export const listCareLogs = (state: CrmDataState, actor: CrmActor, customerId: string | null | undefined): CareLogView[] => {
  const customer = findAccessibleCustomer(state, actor, customerId);
  if (!customer) return [];
  const primaryUserId = getPrimaryUserId(customer.careTeam);
  return state.careLogs
    .filter((log) => log.customerId === customer.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((log) => toCareLogView(state, log, primaryUserId));
};

export const toAppointmentView = (state: CrmDataState, appointment: Appointment, customer: Customer): AppointmentView => ({
  id: appointment.id,
  customer: {
    id: customer.id,
    fullName: customer.fullName,
    phoneMasked: maskPhoneDisplay(customer.phone),
    status: toStatusRef(state.catalogs, customer.statusId),
    projects: toProjectRefs(state.catalogs, customer.interestedProjectIds),
  },
  type: appointment.type,
  title: appointment.title,
  startAt: appointment.startAt,
  endAt: appointment.endAt,
  location: appointment.location,
  note: appointment.note,
  assignee: requireUserRef(state.users, appointment.assigneeId),
  remindBeforeMinutes: appointment.remindBeforeMinutes,
  status: appointment.status,
  completedAt: appointment.completedAt,
  createdBy: requireUserRef(state.users, appointment.createdBy),
  smsZnsAuto: appointment.smsZnsAuto,
  calendarSync: appointment.calendarSync,
});

/** `GET /crm/appointments` — lịch của khách trong phạm vi, sắp theo `startAt`. Bỏ lịch đã huỷ. */
export const listAppointments = (state: CrmDataState, actor: CrmActor, query: AppointmentListQuery = {}): AppointmentView[] => {
  const customersById = new Map(getAccessibleCustomers(state, actor).map((customer) => [customer.id, customer]));
  return state.appointments
    .filter((appointment) => {
      if (appointment.status === 'CANCELED' && query.status !== 'CANCELED') return false;
      if (!customersById.has(appointment.customerId)) return false;
      if (query.customerId && appointment.customerId !== query.customerId) return false;
      if (query.status && appointment.status !== query.status) return false;
      const dateKey = toVnDateKey(appointment.startAt);
      if (query.from && dateKey < query.from) return false;
      if (query.to && dateKey > query.to) return false;
      return true;
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((appointment) => toAppointmentView(state, appointment, customersById.get(appointment.customerId) as Customer));
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
    .map((view) => ({ viewer: requireUserRef(state.users, view.viewerId), viewedAt: view.viewedAt }));
};

/** Băm FNV-1a 32 bit -> base36 (token mờ cho mô phỏng; backend dùng token ký/ngẫu nhiên có hạn). */
const hashRef = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/** Token mờ để gửi đề nghị tham gia: gắn với người gửi, KHÔNG chứa id nội bộ của khách (TB9). */
export const makeJoinRef = (actorId: string, customerId: string): string => `JR-${hashRef(`${actorId}|${customerId}|stnd-crm`)}${hashRef(`${customerId}|${actorId}`)}`;

/** Đổi token về khách; không khớp -> null (cùng một kết quả cho "không tồn tại" và "không được phép"). */
export const resolveJoinRef = (state: CrmDataState, actorId: string, ref: string): Customer | null =>
  state.customers.find((customer) => makeJoinRef(actorId, customer.id) === ref) ?? null;

/**
 * `POST /crm/customers/phone-lookups` (X2): chỉ trả "đã có, do [tên] chăm sóc" — KHÔNG lộ tên/mã/SĐT của khách ngoài phạm vi.
 */
export const lookupPhone = (
  state: CrmDataState,
  actor: CrmActor,
  phone: string,
  excludeCustomerId?: string,
): PhoneLookupResult | null => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const existing = state.customers.find((customer) => customer.id !== excludeCustomerId && normalizePhone(customer.phone) === normalizedPhone);
  if (!existing) {
    return { normalizedPhone, exists: false, isAccessible: false, caredByName: null, canRequestJoin: false, hasPendingRequest: false };
  }
  const isAccessible = canAccessCustomer(actor, existing, state.users);
  const primary = existing.primaryAssigneeId ? state.users.find((user) => user.id === existing.primaryAssigneeId) : undefined;
  const hasPendingRequest = state.careTeamRequests.some(
    (request) => request.customerId === existing.id && request.requesterId === actor.userId && request.status === 'PENDING',
  );
  const canRequestJoin = !isAccessible && actor.role !== 'ADMIN' && !hasPendingRequest;
  return {
    normalizedPhone,
    exists: true,
    isAccessible,
    customerId: isAccessible ? existing.id : undefined,
    // Người đã xem được khách thì dùng "Xem hồ sơ" (không cần đề nghị); người chưa xem được mới có token để đề nghị.
    customerRef: canRequestJoin ? makeJoinRef(actor.userId, existing.id) : undefined,
    caredByName: primary?.displayName ?? null,
    canRequestJoin,
    hasPendingRequest,
  };
};

/** `GET /crm/care-team-requests?box=mine|to-review` */
export const listCareTeamRequests = (state: CrmDataState, actor: CrmActor, box: 'mine' | 'to-review'): CareTeamRequestView[] =>
  state.careTeamRequests
    .filter((request) => {
      if (box === 'mine') return request.requesterId === actor.userId;
      const customer = state.customers.find((item) => item.id === request.customerId);
      if (!customer || !canAccessCustomer(actor, customer, state.users)) return false;
      return getCustomerPermissions(actor, customer).canReviewJoinRequests;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((request) => {
      const customer = state.customers.find((item) => item.id === request.customerId);
      // Người gửi không được biết tên khách (X2) — chỉ người duyệt thấy.
      const isReviewer = box === 'to-review';
      return {
        id: request.id,
        customer: isReviewer && customer ? { id: customer.id, fullName: customer.fullName } : null,
        requester: requireUserRef(state.users, request.requesterId),
        message: request.message,
        status: request.status,
        createdAt: request.createdAt,
        resolvedBy: toUserRef(state.users, request.resolvedBy),
        resolvedAt: request.resolvedAt,
      };
    });

/** `GET /crm/assignable-users` — người có thể phân chăm sóc (MANAGER/STAFF đang hoạt động; A thấy tất cả, M/S thấy nhóm mình). */
export const listAssignableUsers = (state: CrmDataState, actor: CrmActor): AssignableUser[] =>
  state.users
    .filter((user) => user.isActive && user.role !== 'ADMIN')
    .filter((user) => actor.role === 'ADMIN' || user.teamId === actor.teamId || actor.managedTeamIds.includes(user.teamId ?? ''))
    .map((user) => {
      const team = state.teams.find((item) => item.id === user.teamId);
      return { id: user.id, displayName: user.displayName, fullName: user.fullName, role: user.role, team: team ? { id: team.id, label: team.name } : null };
    });
