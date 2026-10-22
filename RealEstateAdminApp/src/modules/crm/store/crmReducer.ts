/**
 * Reducer thuần của store CRM (mô phỏng phía máy chủ cho prototype).
 * - Không side effect: id, thời điểm, người thực hiện đi kèm action (`MutationMeta`) -> test được tuyệt đối.
 * - Mọi cập nhật hồ sơ khách đi qua `applyCustomerUpdate`: tự ghi `lastUpdatedAt/By` (C7), tăng `version`,
 *   tính lại trường phi chuẩn hoá (primaryAssigneeId, searchText, occasions, personaCompleteness) và ghi `changeLogs` (X4).
 * - Bất biến được chặn ngay ở reducer (giống ràng buộc DB): SĐT duy nhất (QT4), nhóm chăm sóc đúng 1 PRIMARY (QT7).
 */
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import { diffCustomer } from '@crm/lib/changeTracking';
import {
  buildSearchText,
  computeOccasions,
  computePersonaCompleteness,
  findNonAssignableUserIds,
  getPrimaryUserId,
  isCareTeamValid,
} from '@crm/lib/customerRules';
import { normalizePhone } from '@crm/lib/phone';
import type { ActiveModal, CustomerFilters } from '@crm/types/app';
import type {
  Appointment,
  AppointmentStatus,
  Area,
  AuditLog,
  CareLog,
  CareTeamRequest,
  CatalogItem,
  ChangeAction,
  ChangeLog,
  ContactResult,
  CrmCatalogs,
  CrmSettings,
  CrmUser,
  Customer,
  CustomerStatusItem,
  FieldChange,
  NationalIdView,
  Project,
  Tag,
  Team,
} from '@crm/types/crm';

/** Phần dữ liệu nghiệp vụ được lưu localStorage (mô phỏng database). */
export interface CrmDataState {
  users: CrmUser[];
  teams: Team[];
  catalogs: CrmCatalogs;
  settings: CrmSettings;
  customers: Customer[];
  careLogs: CareLog[];
  appointments: Appointment[];
  changeLogs: ChangeLog[];
  nationalIdViews: NationalIdView[];
  careTeamRequests: CareTeamRequest[];
  /** Nhật ký thao tác không thuộc riêng 1 khách: dự án, xuất danh sách (04 §3.7). Mới nhất trước. */
  auditLogs: AuditLog[];
}

export interface CrmSession {
  /** Người dùng đang đăng nhập (mock). */
  currentUserId: string;
}

export interface CrmState extends CrmDataState {
  session: CrmSession;
  filters: CustomerFilters;
  /**
   * Khách đang chọn. Trên route `/crm/customers/:customerId/*`, CrmProvider ghi đè giá trị này bằng id trong URL.
   */
  selectedCustomerId: string | null;
  activeModal: ActiveModal | null;
}

/** Ai làm, lúc nào, id bản ghi nhật ký thay đổi — do lớp API sinh. */
export interface MutationMeta {
  actorId: string;
  now: string;
  changeLogId: string;
  source?: ChangeLog['source'];
  reason?: string;
}

export type CustomerPatch = Partial<
  Omit<Customer, 'id' | 'lastUpdatedAt' | 'lastUpdatedBy' | 'version' | 'searchText' | 'primaryAssigneeId' | 'occasions' | 'personaCompleteness'>
>;

export type CatalogKind = 'statuses' | 'leadSources' | 'areas' | 'projects' | 'tags' | 'contactResults';

type CatalogItemOf<K extends CatalogKind> = CrmCatalogs[K][number];

export type CrmAction =
  | { type: 'session/setUser'; userId: string }
  | { type: 'customers/select'; customerId: string }
  | { type: 'customers/create'; customer: Customer; meta: MutationMeta; action?: ChangeAction }
  | { type: 'customers/update'; customerId: string; patch: CustomerPatch; action: ChangeAction; meta: MutationMeta }
  | { type: 'careLogs/add'; careLog: CareLog; meta: MutationMeta }
  | { type: 'followUps/complete'; careLogId: string; meta: MutationMeta }
  | { type: 'appointments/add'; appointment: Appointment; meta: MutationMeta }
  | { type: 'appointments/setStatus'; appointmentId: string; status: AppointmentStatus; meta: MutationMeta }
  | { type: 'nationalIds/viewed'; view: NationalIdView; meta: MutationMeta }
  | { type: 'phones/viewed'; customerId: string; meta: MutationMeta }
  | { type: 'careTeamRequests/add'; request: CareTeamRequest; meta: MutationMeta }
  | { type: 'careTeamRequests/resolve'; requestId: string; status: CareTeamRequest['status']; meta: MutationMeta }
  | { type: 'catalogs/upsert'; kind: CatalogKind; item: CatalogItemOf<CatalogKind> }
  | { type: 'auditLogs/add'; log: AuditLog }
  | { type: 'users/upsert'; user: CrmUser }
  | { type: 'settings/update'; changes: Partial<CrmSettings> }
  | { type: 'filters/set'; changes: Partial<CustomerFilters> }
  | { type: 'filters/reset' }
  | { type: 'modal/open'; modal: ActiveModal }
  | { type: 'modal/close' };

/** Giới hạn log trong localStorage (PROTOTYPE: backend dùng collection riêng + TTL/lưu trữ): giữ mục mới nhất. */
export const MAX_AUDIT_LOGS = 1000;
export const MAX_PHONE_VIEW_LOGS = 1000;

export const DEFAULT_FILTERS: CustomerFilters = {
  q: '',
  listGroup: 'ALL',
  statusIds: [],
  sourceIds: [],
  projectIds: [],
  areaIds: [],
  assigneeIds: [],
  primaryAssigneeIds: [],
  progress: [],
  updatedFrom: '',
  updatedTo: '',
  occupation: '',
  tagIds: [],
};

export const createInitialState = (data: CrmDataState, session: CrmSession): CrmState => ({
  ...data,
  session,
  filters: DEFAULT_FILTERS,
  selectedCustomerId: null,
  activeModal: null,
});

// ---------------------------------------------------------------------------
// Tiện ích nội bộ
// ---------------------------------------------------------------------------

const findUser = (state: CrmDataState, userId: string): CrmUser | undefined => state.users.find((user) => user.id === userId);

/** Trường phi chuẩn hoá luôn tính lại từ dữ liệu gốc (không bao giờ nhận từ client). */
const withDerivedFields = (customer: Customer): Customer => ({
  ...customer,
  primaryAssigneeId: getPrimaryUserId(customer.careTeam),
  searchText: buildSearchText(customer),
  occasions: computeOccasions(customer.persona, PERSONA_FIELDS),
  personaCompleteness: computePersonaCompleteness(customer.persona, PERSONA_FIELDS),
});

const createChangeLog = (
  state: CrmDataState,
  customerId: string,
  action: ChangeAction,
  changes: FieldChange[],
  meta: MutationMeta,
): ChangeLog => {
  const actor = findUser(state, meta.actorId);
  return {
    id: meta.changeLogId,
    customerId,
    action,
    actorId: meta.actorId,
    actorName: actor?.displayName ?? 'Hệ thống',
    actorRole: actor?.role ?? 'ADMIN',
    changes,
    reason: meta.reason,
    source: meta.source ?? 'WEB',
    createdAt: meta.now,
  };
};

const isPhoneTaken = (customers: readonly Customer[], phone: string, excludeCustomerId?: string): boolean => {
  const normalized = normalizePhone(phone);
  return customers.some(
    (customer) => customer.id !== excludeCustomerId && (normalizePhone(customer.phone) ?? customer.phone) === (normalized ?? phone),
  );
};

/** Lịch hẹn sắp tới gần nhất (SCHEDULED, chưa qua) của khách — cột "HẸN" (04 §3.2 `nextAppointmentAt`). */
const getNextAppointmentAt = (appointments: readonly Appointment[], customerId: string, now: string): string | null =>
  appointments
    .filter((appointment) => appointment.customerId === customerId && appointment.status === 'SCHEDULED' && appointment.startAt >= now)
    .map((appointment) => appointment.startAt)
    .sort()[0] ?? null;

interface WorkHandover {
  appointments: Appointment[];
  careLogs: CareLog[];
  changes: FieldChange[];
}

/** Việc của người vừa bị gỡ khỏi nhóm -> PRIMARY mới của khách. Không có người bị gỡ/không có PRIMARY -> null. */
const reassignWorkOfRemovedMembers = (state: CrmDataState, before: Customer, after: Customer): WorkHandover | null => {
  const removedIds = before.careTeam.map((member) => member.userId).filter((userId) => !after.careTeam.some((member) => member.userId === userId));
  const primaryId = getPrimaryUserId(after.careTeam);
  if (removedIds.length === 0 || !primaryId) return null;
  const nameOf = (userId: string) => findUser(state, userId)?.displayName ?? userId;
  const changes: FieldChange[] = [];
  const appointments = state.appointments.map((appointment) => {
    if (appointment.customerId !== before.id || appointment.status !== 'SCHEDULED' || !removedIds.includes(appointment.assigneeId)) return appointment;
    changes.push({ field: `Lịch hẹn "${appointment.title}" chuyển người thực hiện`, from: nameOf(appointment.assigneeId), to: nameOf(primaryId) });
    return { ...appointment, assigneeId: primaryId };
  });
  const careLogs = state.careLogs.map((log) => {
    const next = log.nextAction;
    if (log.customerId !== before.id || !next?.dueAt || next.completedAt || next.appointmentId) return log;
    const ownerId = next.assigneeId ?? (log.source === 'SYSTEM' ? getPrimaryUserId(before.careTeam) : log.authorId);
    if (!ownerId || !removedIds.includes(ownerId)) return log;
    changes.push({ field: `Bước tiếp theo "${next.suggestion || 'Chăm sóc tiếp theo'}" chuyển người phụ trách`, from: nameOf(ownerId), to: nameOf(primaryId) });
    return { ...log, nextAction: { ...next, assigneeId: primaryId } };
  });
  return changes.length === 0 ? null : { appointments, careLogs, changes };
};

/**
 * Cập nhật 1 khách theo chuẩn backend: kiểm bất biến -> áp patch -> tính lại phi chuẩn hoá -> diff -> ghi changeLog.
 * Không có thay đổi thực sự -> giữ nguyên state (không tăng version, không ghi log rỗng).
 */
const applyCustomerUpdate = (
  state: CrmState,
  customerId: string,
  patch: CustomerPatch,
  action: ChangeAction,
  meta: MutationMeta,
  extraChanges: FieldChange[] = [],
): CrmState => {
  const before = state.customers.find((customer) => customer.id === customerId);
  if (!before) return state;
  if (patch.phone !== undefined && isPhoneTaken(state.customers, patch.phone, customerId)) return state;
  if (patch.careTeam !== undefined) {
    if (!isCareTeamValid(patch.careTeam)) return state;
    // Chỉ kiểm người MỚI vào nhóm (người cũ đã khoá vẫn được giữ cho tới khi bị gỡ).
    const newcomers = patch.careTeam.map((member) => member.userId).filter((userId) => !before.careTeam.some((member) => member.userId === userId));
    if (findNonAssignableUserIds(state.users, newcomers).length > 0) return state;
  }

  const statusChangedAt = patch.statusId !== undefined && patch.statusId !== before.statusId ? meta.now : before.statusChangedAt;
  const merged = withDerivedFields({ ...before, ...patch, id: before.id, statusChangedAt });
  const changes = [...diffCustomer(before, merged, state.catalogs, state.users), ...extraChanges];
  // Đổi số CCCD mà 4 số cuối trùng số cũ: diff không thấy -> ghi nhận bằng dấu thời gian đổi CCCD.
  if (patch.nationalIdUpdatedAt && patch.nationalIdUpdatedAt !== before.nationalIdUpdatedAt && !changes.some((change) => change.field === 'CCCD')) {
    const masked = before.nationalIdLast4 ? `••••${before.nationalIdLast4}` : '';
    changes.push({ field: 'CCCD', from: masked, to: `${masked} (đã đổi số)` });
  }
  const hasTouchedDerived = merged.lastCareLogAt !== before.lastCareLogAt || merged.nextAppointmentAt !== before.nextAppointmentAt;
  if (changes.length === 0 && !hasTouchedDerived) return state;

  const after: Customer = { ...merged, lastUpdatedAt: meta.now, lastUpdatedBy: meta.actorId, version: before.version + 1 };
  // Gỡ người khỏi nhóm: chuyển lịch hẹn đang chờ + bước tiếp theo chưa xong của họ sang phụ trách chính (C5).
  const handover = patch.careTeam !== undefined ? reassignWorkOfRemovedMembers(state, before, after) : null;
  const allChanges = handover ? [...changes, ...handover.changes] : changes;
  return {
    ...state,
    appointments: handover?.appointments ?? state.appointments,
    careLogs: handover?.careLogs ?? state.careLogs,
    customers: state.customers.map((customer) => (customer.id === customerId ? after : customer)),
    changeLogs: allChanges.length > 0 ? [createChangeLog(state, customerId, action, allChanges, meta), ...state.changeLogs] : state.changeLogs,
  };
};

/** Chỉ giữ MAX_PHONE_VIEW_LOGS log xem SĐT mới nhất (các loại log khác không bị đụng). Mới nhất đứng đầu mảng. */
const capPhoneViewLogs = (changeLogs: ChangeLog[]): ChangeLog[] => {
  let remaining = MAX_PHONE_VIEW_LOGS;
  return changeLogs.filter((log) => log.action !== 'PHONE_VIEWED' || (remaining-- > 0));
};

const upsertById = <T extends { id: string }>(items: readonly T[], item: T): T[] =>
  items.some((candidate) => candidate.id === item.id)
    ? items.map((candidate) => (candidate.id === item.id ? item : candidate))
    : [...items, item];

const upsertCatalog = (catalogs: CrmCatalogs, kind: CatalogKind, item: CatalogItemOf<CatalogKind>): CrmCatalogs => {
  switch (kind) {
    case 'statuses':
      return { ...catalogs, statuses: upsertById(catalogs.statuses, item as CustomerStatusItem) };
    case 'leadSources':
      return { ...catalogs, leadSources: upsertById(catalogs.leadSources, item as CatalogItem) };
    case 'areas':
      return { ...catalogs, areas: upsertById(catalogs.areas, item as Area) };
    case 'projects':
      return { ...catalogs, projects: upsertById(catalogs.projects, item as Project) };
    case 'tags':
      return { ...catalogs, tags: upsertById(catalogs.tags, item as Tag) };
    case 'contactResults':
      return { ...catalogs, contactResults: upsertById(catalogs.contactResults, item as ContactResult) };
    default:
      return catalogs;
  }
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const crmReducer = (state: CrmState, action: CrmAction): CrmState => {
  switch (action.type) {
    case 'session/setUser':
      return state.users.some((user) => user.id === action.userId)
        ? { ...state, session: { currentUserId: action.userId } }
        : state;

    case 'customers/select':
      return state.customers.some((customer) => customer.id === action.customerId)
        ? { ...state, selectedCustomerId: action.customerId }
        : state;

    case 'customers/create': {
      const { customer, meta } = action;
      // QT4: SĐT duy nhất toàn hệ thống; QT3: phải có tên + SĐT; QT7: nhóm chăm sóc hợp lệ.
      if (!customer.fullName.trim() || !normalizePhone(customer.phone)) return state;
      if (isPhoneTaken(state.customers, customer.phone) || state.customers.some((item) => item.id === customer.id)) return state;
      if (!isCareTeamValid(customer.careTeam) || findNonAssignableUserIds(state.users, customer.careTeam.map((member) => member.userId)).length > 0) return state;
      const created = withDerivedFields({ ...customer, lastUpdatedAt: meta.now, lastUpdatedBy: meta.actorId, version: 1 });
      return {
        ...state,
        customers: [created, ...state.customers],
        changeLogs: [createChangeLog(state, created.id, action.action ?? 'CUSTOMER_CREATED', [], meta), ...state.changeLogs],
      };
    }

    case 'customers/update':
      return applyCustomerUpdate(state, action.customerId, action.patch, action.action, action.meta);

    case 'careLogs/add': {
      const { careLog, meta } = action;
      const customer = state.customers.find((item) => item.id === careLog.customerId);
      if (!customer || !careLog.content.trim()) return state;
      const withLog = { ...state, careLogs: [careLog, ...state.careLogs] };
      const lastCareLogAt = customer.lastCareLogAt && customer.lastCareLogAt > careLog.occurredAt ? customer.lastCareLogAt : careLog.occurredAt;
      return applyCustomerUpdate(withLog, customer.id, { lastCareLogAt }, 'CARE_LOG_CREATED', meta, [
        { field: 'Nhật ký chăm sóc', from: '', to: careLog.content.length > 80 ? `${careLog.content.slice(0, 80)}…` : careLog.content },
      ]);
    }

    case 'followUps/complete': {
      const target = state.careLogs.find((log) => log.id === action.careLogId);
      if (!target?.nextAction || target.nextAction.completedAt) return state;
      const withDone = {
        ...state,
        careLogs: state.careLogs.map((log) =>
          log.id === action.careLogId && log.nextAction ? { ...log, nextAction: { ...log.nextAction, completedAt: action.meta.now } } : log,
        ),
      };
      // Ghi lịch sử + cập nhật lastUpdatedAt/By/version như mọi thay đổi hồ sơ khác (TB4).
      return applyCustomerUpdate(withDone, target.customerId, {}, 'FOLLOW_UP_COMPLETED', action.meta, [
        { field: 'Bước tiếp theo', from: target.nextAction.suggestion || 'Chăm sóc tiếp theo', to: 'Đã hoàn thành' },
      ]);
    }

    case 'appointments/add': {
      const { appointment, meta } = action;
      const customer = state.customers.find((item) => item.id === appointment.customerId);
      if (!customer) return state;
      const appointments = [appointment, ...state.appointments];
      const withAppointment = { ...state, appointments };
      return applyCustomerUpdate(
        withAppointment,
        customer.id,
        { nextAppointmentAt: getNextAppointmentAt(appointments, customer.id, meta.now) },
        'APPOINTMENT_CREATED',
        meta,
        [{ field: 'Lịch hẹn', from: '', to: appointment.title }],
      );
    }

    case 'appointments/setStatus': {
      const target = state.appointments.find((appointment) => appointment.id === action.appointmentId);
      if (!target || target.status === action.status) return state;
      const appointments = state.appointments.map((appointment) =>
        appointment.id === action.appointmentId
          ? { ...appointment, status: action.status, completedAt: action.status === 'DONE' ? action.meta.now : null }
          : appointment,
      );
      return applyCustomerUpdate(
        { ...state, appointments },
        target.customerId,
        { nextAppointmentAt: getNextAppointmentAt(appointments, target.customerId, action.meta.now) },
        'APPOINTMENT_UPDATED',
        action.meta,
        [{ field: `Lịch hẹn "${target.title}"`, from: target.status, to: action.status }],
      );
    }

    case 'phones/viewed': {
      if (!state.customers.some((customer) => customer.id === action.customerId)) return state;
      const changeLogs = [createChangeLog(state, action.customerId, 'PHONE_VIEWED', [], action.meta), ...state.changeLogs];
      return { ...state, changeLogs: capPhoneViewLogs(changeLogs) };
    }

    case 'nationalIds/viewed':
      return {
        ...state,
        nationalIdViews: [action.view, ...state.nationalIdViews],
        changeLogs: [createChangeLog(state, action.view.customerId, 'NATIONAL_ID_VIEWED', [], action.meta), ...state.changeLogs],
      };

    case 'careTeamRequests/add': {
      const isDuplicatePending = state.careTeamRequests.some(
        (request) =>
          request.customerId === action.request.customerId && request.requesterId === action.request.requesterId && request.status === 'PENDING',
      );
      if (isDuplicatePending) return state;
      return {
        ...state,
        careTeamRequests: [action.request, ...state.careTeamRequests],
        changeLogs: [createChangeLog(state, action.request.customerId, 'JOIN_REQUEST_CREATED', [], action.meta), ...state.changeLogs],
      };
    }

    case 'careTeamRequests/resolve': {
      const request = state.careTeamRequests.find((item) => item.id === action.requestId);
      if (!request || request.status !== 'PENDING') return state;
      return {
        ...state,
        careTeamRequests: state.careTeamRequests.map((item) =>
          item.id === action.requestId ? { ...item, status: action.status, resolvedBy: action.meta.actorId, resolvedAt: action.meta.now } : item,
        ),
        changeLogs: [
          createChangeLog(state, request.customerId, 'JOIN_REQUEST_RESOLVED', [{ field: 'Đề nghị tham gia', from: 'PENDING', to: action.status }], action.meta),
          ...state.changeLogs,
        ],
      };
    }

    case 'catalogs/upsert':
      return { ...state, catalogs: upsertCatalog(state.catalogs, action.kind, action.item) };

    case 'auditLogs/add':
      return { ...state, auditLogs: [action.log, ...state.auditLogs].slice(0, MAX_AUDIT_LOGS) };

    case 'users/upsert': {
      // Đồng bộ quản lý nhóm theo vai trò: Quản lý của nhóm `teamId` (phạm vi QT6 dựa trên `teams.managerIds`).
      const { user } = action;
      const teams = state.teams.map((team) => {
        const managerIds = team.managerIds.filter((id) => id !== user.id);
        if (user.isActive && user.role === 'MANAGER' && user.teamId === team.id) managerIds.push(user.id);
        return managerIds.length === team.managerIds.length && managerIds.every((id, index) => id === team.managerIds[index]) ? team : { ...team, managerIds };
      });
      return { ...state, users: upsertById(state.users, user), teams };
    }

    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.changes } };

    case 'filters/set':
      return { ...state, filters: { ...state.filters, ...action.changes } };

    case 'filters/reset':
      return { ...state, filters: { ...DEFAULT_FILTERS, listGroup: state.filters.listGroup } };

    case 'modal/open':
      return { ...state, activeModal: action.modal };

    case 'modal/close':
      return state.activeModal === null ? state : { ...state, activeModal: null };

    default:
      return state;
  }
};
