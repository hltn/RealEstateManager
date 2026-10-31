/**
 * [Prototype] Hook React của lớp truy cập dữ liệu CRM chạy trên STORE MOCK — thay `hooks.ts` của app chính (React Query gọi API thật).
 * CÙNG tên hook, tham số và kiểu trả về (`{ data, isLoading, isFetching, isError, error, refetch }`...) nên màn chép từ app chính chạy nguyên.
 * Dữ liệu tính đồng bộ từ store (`queries.ts`/`dailyTasks.ts`) nên `isLoading`/`isError` luôn false; riêng thao tác ghi có trễ ngắn
 * (xem `crmWriteApi.ts`) và các hook quản trị trả lỗi 403 khi người dùng không đủ quyền (hiện ở nhánh lỗi của màn như app chính).
 */
import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import { addDaysToDateKey, getVnTodayKey } from '@crm/lib/dateTime';
import { buildAssigneeFilterOptions, type AssigneeFilterOption } from '@crm/lib/assigneeFilter';
import { isValidPhone } from '@crm/lib/phone';
import { listProjectFilterOptions, type ProjectFilterOption } from '@crm/lib/projectRules';
import { useCrmRawState, useCrmStore } from '@crm/store/hooks';
import type { CrmState } from '@crm/store/crmReducer';
import type { AdminUser, CrmCatalogs, CrmSettings, CrmUser, PersonaFieldDefinition, Team, TeamMember } from '@crm/types/crm';
import { useAuthStore } from '../../../stores/auth.store';
import { crmRoleOf } from '../../../utils/userRoles';
import { type CrmActor } from './access';
import { resolveActor } from './actor';
import { countCatalogUsage } from './catalogAdmin';
import { createCrmWriteApi, type CrmApi } from './crmWriteApi';
import { getDailyTaskSummary, listDailyTasks } from './dailyTasks';
import {
  canViewTeamMembers,
  countTeamMembers,
  getCustomer,
  getCustomerPersona,
  getListCounts,
  listAppointments,
  listAssignableUsers,
  listCareLogs,
  listCareTeamRequests,
  listCustomers,
  listDeletedCustomers,
  listHistories,
  listNationalIdViews,
  listTeamMembers,
  lookupPhone,
} from './queries';
import type {
  ApiError,
  ApiResult,
  AppointmentListQuery,
  AppointmentView,
  AssignableUser,
  CareLogView,
  CareTeamRequestView,
  CustomerDetail,
  CustomerListItem,
  CustomerListQuery,
  CustomerPersonaView,
  DailyTask,
  DailyTaskQuery,
  DeletedCustomerItem,
  DeletedCustomerQuery,
  HistoryEntry,
  ListCounts,
  NationalIdViewEntry,
  Paginated,
  PhoneLookupResult,
} from './types';

export interface QueryState<T> {
  data: T;
  isLoading: boolean;
  /** Đang tải lại ở nền (đổi trang/bộ lọc) — dữ liệu cũ vẫn hiển thị. */
  isFetching: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/** [Prototype] Khóa query giữ để màn chép từ app chính (`UserManagementScreen`) vẫn `invalidateQueries` được; store mock tự phản ứng nên không dùng thật. */
export const crmKeys = {
  catalogs: ['crm', 'catalogs'] as const,
  data: ['crm', 'data'] as const,
};

const noop = () => undefined;

/** Kết quả đồng bộ của mock: không tải, không lỗi. */
const done = <T>(data: T): QueryState<T> => ({ data, isLoading: false, isFetching: false, isError: false, error: null, refetch: noop });

/** Lỗi giả lập (vd 403 khi người không đủ quyền gọi API quản trị). */
const failed = <T>(data: T, error: ApiError): QueryState<T> => ({ data, isLoading: false, isFetching: false, isError: true, error, refetch: noop });

export { resolveActor };

const FORBIDDEN: ApiError = { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Bạn không có quyền thực hiện thao tác này.' };

const EMPTY_PAGE = <T,>(limit = 20): Paginated<T> => ({ data: [], meta: { total: 0, page: 1, limit, totalPages: 1 } });

/** Làm mới sau thao tác ghi: store mock tự phản ứng nên không phải làm gì; giữ hàm để tương thích với app chính. */
export const invalidateCrm = async (_queryClient: QueryClient, _options: { shouldIncludeCatalogs?: boolean } = {}): Promise<void> => undefined;

// ---------------------------------------------------------------------------------------------------------------------
// Người dùng hiện tại + quyền
// ---------------------------------------------------------------------------------------------------------------------

type SessionUser = ReturnType<typeof useAuthStore.getState>['user'];

/** Actor (người dùng đăng nhập + nhóm quản lý) để ẩn nút theo quyền. Ổn định tham chiếu: chỉ đổi khi người dùng/nhóm/phiên đổi (TB8). */
export const useCrmActor = (): CrmActor => {
  const authUser = useAuthStore((state) => state.user);
  const { users, teams } = useCrmRawState();
  return useMemo(() => resolveActor(authUser, users, teams), [authUser, users, teams]);
};

// ---------------------------------------------------------------------------------------------------------------------
// Danh mục
// ---------------------------------------------------------------------------------------------------------------------

const EMPTY_CATALOGS: CrmCatalogs = { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] };

/** Người phân chăm sóc được -> `CrmUser` (như `assignableToUser` của app chính: backend không trả họ tên đầy đủ/chức danh ở danh sách này). */
const assignableToUser = (user: AssignableUser): CrmUser => ({
  id: user.id,
  fullName: user.displayName,
  displayName: user.displayName,
  role: user.role,
  jobTitle: '',
  teamId: user.team?.id ?? null,
  teamName: user.team?.label,
  isActive: true,
});

const toSelfUser = (authUser: NonNullable<SessionUser>): CrmUser => ({
  id: authUser._id,
  fullName: authUser.displayName,
  displayName: authUser.displayName,
  role: crmRoleOf(authUser),
  jobTitle: '',
  teamId: authUser.teamId ?? null,
  isActive: true,
});

/** Nhóm người gọi được thấy (`resolveVisibleTeamIds`): Quản trị mọi nhóm; Quản lý nhóm mình quản lý + nhóm mình thuộc. Nhân viên không gọi (403). */
const listVisibleTeams = (state: CrmState, actor: CrmActor): (Team & { memberCount: number })[] =>
  state.teams
    .filter((team) => actor.role === 'ADMIN' || (actor.role === 'MANAGER' && (actor.managedTeamIds.includes(team.id) || actor.teamIds.includes(team.id))))
    .map((team) => ({ ...team, memberCount: countTeamMembers(state.users, team.id) }));

/** Danh mục + người dùng + nhóm + cấu hình chân dung. */
export const useCatalogs = () => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const authUser = useAuthStore((current) => current.user);
  const canSeeTeams = actor.role === 'ADMIN' || actor.role === 'MANAGER';

  /** Người phân chăm sóc được + bản thân (để tên mình luôn tra được). */
  const users = useMemo<CrmUser[]>(() => {
    const base = listAssignableUsers(state, actor).map(assignableToUser);
    if (!authUser || base.some((user) => user.id === authUser._id)) return base;
    return [...base, toSelfUser(authUser)];
  }, [state, actor, authUser]);
  const teams = useMemo(() => (canSeeTeams ? listVisibleTeams(state, actor) : []), [canSeeTeams, state, actor]);

  return {
    catalogs: state.catalogs ?? EMPTY_CATALOGS,
    users,
    teams,
    settings: (canSeeTeams ? state.settings : null) as CrmSettings | null,
    personaFields: PERSONA_FIELDS,
    isLoading: false,
    isError: false,
    error: null as ApiError | null,
    refetch: noop,
  };
};

/** Ô LỌC "Người phụ trách" (`purpose=filter`): lọc ≠ gán. */
export const useAssigneeFilterOptions = (): AssigneeFilterOption[] => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const authUser = useAuthStore((current) => current.user);
  return useMemo(
    () => buildAssigneeFilterOptions(listAssignableUsers(state, actor, 'filter').map(assignableToUser), authUser ? toSelfUser(authUser) : null),
    [state, actor, authUser],
  );
};

/** Map `fieldKey` -> định nghĩa trường (để đổi mã/nhãn lựa chọn). */
export const usePersonaFieldMap = (): ReadonlyMap<string, PersonaFieldDefinition> => useMemo(() => new Map(PERSONA_FIELDS.map((field) => [field.key, field])), []);

/** Số khách quan tâm từng dự án (`customerCount`) — trang Dự án + ô lọc. */
export const useProjectsWithCounts = (): QueryState<Map<string, number>> => {
  const state = useCrmRawState();
  return useMemo(() => done(new Map(state.catalogs.projects.map((project) => [project.id, countCatalogUsage(state, 'projects', project.id)]))), [state]);
};

/** Lựa chọn dự án cho ô lọc: dự án đang hoạt động + dự án đã ngừng nhưng còn khách (`customerCount`) — loại dự án xóa mềm. */
export const useProjectFilterOptions = (): ProjectFilterOption[] => {
  const { catalogs } = useCatalogs();
  const { data: counts } = useProjectsWithCounts();
  const referenced = useMemo(() => new Set([...counts].filter(([, count]) => count > 0).map(([id]) => id)), [counts]);
  return useMemo(() => listProjectFilterOptions(catalogs.projects, referenced), [catalogs.projects, referenced]);
};

/** `GET /crm/assignable-users` */
export const useAssignableUsers = (): QueryState<AssignableUser[]> => {
  const { users } = useCatalogs();
  const data = useMemo(
    () => users.filter((user) => user.role !== 'ADMIN').map((user) => ({ id: user.id, displayName: user.displayName, fullName: user.fullName, role: user.role, team: user.teamId ? { id: user.teamId, label: user.teamName ?? '' } : null })),
    [users],
  );
  return done(data);
};

// ---------------------------------------------------------------------------------------------------------------------
// Khách hàng
// ---------------------------------------------------------------------------------------------------------------------

/** `GET /crm/customers` */
export const useCustomerList = (query: CustomerListQuery): QueryState<Paginated<CustomerListItem>> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => done(listCustomers(state, actor, JSON.parse(queryKey) as CustomerListQuery)), [state, actor, queryKey]);
};

/** `GET /crm/customers/list-counts` */
export const useListCounts = (query: CustomerListQuery): QueryState<ListCounts> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => done(getListCounts(state, actor, JSON.parse(queryKey) as CustomerListQuery)), [state, actor, queryKey]);
};

/** `GET /crm/customers/:id` — `data` null khi 404 (ngoài phạm vi); phân biệt bằng `isNotFound`. */
export const useCustomerDetail = (customerId: string | null | undefined): QueryState<CustomerDetail | null> & { isNotFound: boolean } => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const result = useMemo(() => getCustomer(state, actor, customerId), [state, actor, customerId]);
  return { ...done(result), isNotFound: Boolean(customerId) && result === null };
};

/** `GET /crm/customers/:id/persona` */
export const useCustomerPersona = (customerId: string | null | undefined): QueryState<CustomerPersonaView | null> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(getCustomerPersona(state, actor, customerId)), [state, actor, customerId]);
};

const CARE_LOG_PAGE_SIZE = 20;

/** `GET /crm/customers/:id/care-logs` — tải dần (mới nhất trước); `isPrimaryAuthor` theo phụ trách chính hiện tại của khách. */
export const useCareLogs = (customerId: string | null | undefined, _primaryUserId: string | null = null) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const [visible, setVisible] = useState<{ customerId: string | null | undefined; count: number }>({ customerId, count: CARE_LOG_PAGE_SIZE });
  const count = visible.customerId === customerId ? visible.count : CARE_LOG_PAGE_SIZE;
  const all = useMemo(() => listCareLogs(state, actor, customerId), [state, actor, customerId]);
  const data = useMemo<CareLogView[]>(() => all.slice(0, count), [all, count]);
  return {
    ...done(data),
    hasMore: all.length > count,
    isFetchingMore: false,
    loadMore: () => setVisible({ customerId, count: count + CARE_LOG_PAGE_SIZE }),
  };
};

/** `GET /crm/customers/:id/histories` (50 mục mới nhất). */
export const useCustomerHistories = (customerId: string | null | undefined): QueryState<HistoryEntry[]> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(listHistories(state, actor, customerId).slice(0, 50)), [state, actor, customerId]);
};

/** `GET /crm/customers/:id/national-id-views` — chỉ Quản trị/Quản lý (`isEnabled`). */
export const useNationalIdViews = (customerId: string | null | undefined, isEnabled = true): QueryState<NationalIdViewEntry[]> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(isEnabled ? listNationalIdViews(state, actor, customerId) : []), [state, actor, customerId, isEnabled]);
};

/**
 * `POST /crm/customers/phone-lookups` (X2): kiểm trùng SĐT. Dạng truy vấn phản ứng theo state (tự cập nhật khi đề nghị tham gia đổi).
 * Tra ra chính khách đang sửa (SĐT không đổi) không phải là trùng.
 */
export const usePhoneLookup = (phone: string, excludeCustomerId?: string): PhoneLookupResult | null => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => (isValidPhone(phone) ? lookupPhone(state, actor, phone, excludeCustomerId) : null), [state, actor, phone, excludeCustomerId]);
};

// ---------------------------------------------------------------------------------------------------------------------
// Nhóm chăm sóc, lịch hẹn, việc hôm nay
// ---------------------------------------------------------------------------------------------------------------------

/** `GET /crm/care-team-requests` (đang chờ duyệt). Trả thêm `customerId` để lọc theo khách. */
export const useCareTeamRequests = (box: 'mine' | 'to-review', isEnabled = true): QueryState<(CareTeamRequestView & { customerId: string })[]> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => {
    if (!isEnabled) return done<(CareTeamRequestView & { customerId: string })[]>([]);
    const customerIdOf = new Map(state.careTeamRequests.map((request) => [request.id, request.customerId]));
    return done(
      listCareTeamRequests(state, actor, box)
        .filter((item) => item.status === 'PENDING')
        .map((item) => ({ ...item, customerId: customerIdOf.get(item.id) ?? item.customer?.id ?? '' })),
    );
  }, [state, actor, box, isEnabled]);
};

/** Cửa sổ mặc định khi màn không chỉ định: 14 ngày trước tới 45 ngày sau (≤ 62 ngày theo 05 §2.9). */
export const getDefaultAppointmentWindow = (now: Date = new Date()): { from: string; to: string } => {
  const today = getVnTodayKey(now);
  return { from: addDaysToDateKey(today, -14), to: addDaysToDateKey(today, 45) };
};

/** `GET /crm/appointments` */
export const useAppointments = (query: AppointmentListQuery = {}): QueryState<AppointmentView[]> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const defaults = useMemo(() => getDefaultAppointmentWindow(), []);
  const effective = JSON.stringify({ ...query, from: query.from ?? defaults.from, to: query.to ?? defaults.to });
  return useMemo(() => done(listAppointments(state, actor, JSON.parse(effective) as AppointmentListQuery)), [state, actor, effective]);
};

/** [Prototype] Phạm vi mặc định của việc hôm nay: Quản trị "team" (xem tất cả), vai trò khác "mine" như app chính. */
const defaultScopeOf = (actor: CrmActor): 'mine' | 'team' | undefined => (actor.role === 'ADMIN' ? 'team' : undefined);

/** `GET /crm/daily-tasks` (cả 3 nhóm). `q` lọc theo tên khách/nội dung việc/SĐT. */
export const useDailyTasks = (query: DailyTaskQuery = {}): QueryState<DailyTask[]> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  // [Prototype] Quản trị không có khách riêng: không chỉ định phạm vi thì mặc định "Cả nhóm" (team) để màn Việc hôm nay không trống.
  const scope = query.scope ?? defaultScopeOf(actor);
  const { q } = query;
  return useMemo(() => done(listDailyTasks(state, actor, { scope, q })), [state, actor, scope, q]);
};

/** `GET /crm/daily-tasks/summary` — số việc mỗi nhóm cho badge tab. */
export const useDailyTaskSummary = (requestedScope?: 'mine' | 'team'): QueryState<{ overdue: number; today: number; upcoming: number }> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const scope = requestedScope ?? defaultScopeOf(actor);
  return useMemo(() => done(getDailyTaskSummary(listDailyTasks(state, actor, { scope }))), [state, actor, scope]);
};

// ---------------------------------------------------------------------------------------------------------------------
// Thông báo trong app
// ---------------------------------------------------------------------------------------------------------------------

const toNotificationItem = ({ userId: _userId, ...item }: CrmState['notifications'][number]) => item;

/** `GET /notifications/unread-count` */
export const useUnreadNotificationCount = (isEnabled = true): number => {
  const { notifications } = useCrmRawState();
  const userId = useAuthStore((state) => state.user?._id);
  return useMemo(() => (isEnabled ? notifications.filter((item) => item.userId === userId && !item.isRead).length : 0), [notifications, userId, isEnabled]);
};

/** `GET /notifications` — của người đang đăng nhập, mới nhất trước. */
export const useNotifications = (query: { isRead?: boolean; page?: number; limit?: number } = {}, isEnabled = true) => {
  const { notifications } = useCrmRawState();
  const userId = useAuthStore((state) => state.user?._id);
  const { isRead, page = 1, limit = 20 } = query;
  return useMemo(() => {
    const own = isEnabled
      ? notifications.filter((item) => item.userId === userId && (isRead === undefined || item.isRead === isRead)).sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      : [];
    const totalPages = Math.max(1, Math.ceil(own.length / limit));
    const current = Math.min(totalPages, Math.max(1, page));
    return done({ data: own.slice((current - 1) * limit, current * limit).map(toNotificationItem), meta: { total: own.length, page: current, limit, totalPages } });
  }, [notifications, userId, isEnabled, isRead, page, limit]);
};

/** Đánh dấu đã đọc. Nhẹ: không kéo danh mục, dùng được ở header của mọi trang. */
export const useNotificationActions = () => {
  const store = useCrmStore();
  return useMemo(() => {
    const currentUserId = () => useAuthStore.getState().user?._id ?? '';
    return {
      markRead: async (id: string, isRead: boolean): Promise<ApiResult<{ id: string; isRead: boolean }>> => {
        store.getState().dispatch({ type: 'notifications/markRead', id, userId: currentUserId(), isRead });
        return { ok: true, data: { id, isRead } };
      },
      markAllRead: async (): Promise<ApiResult<{ updated: number }>> => {
        store.getState().dispatch({ type: 'notifications/markAllRead', userId: currentUserId() });
        return { ok: true, data: { updated: 0 } };
      },
    };
  }, [store]);
};

// ---------------------------------------------------------------------------------------------------------------------
// Quản trị
// ---------------------------------------------------------------------------------------------------------------------

/** `GET /users` (Quản trị) — bỏ tài khoản chỉ có EDITOR (không dùng CRM). */
export const useAdminUsers = (isEnabled = true): QueryState<AdminUser[]> => {
  const { users } = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => {
    if (!isEnabled) return done<AdminUser[]>([]);
    if (actor.role !== 'ADMIN') return failed<AdminUser[]>([], FORBIDDEN);
    return done(users.filter((user) => user.roles.some((role) => role !== 'EDITOR')));
  }, [users, actor.role, isEnabled]);
};

/** `GET /teams/:id/members` — phân trang + tìm theo tên. Quản trị xem mọi nhóm; Quản lý chỉ nhóm mình quản lý (nhóm khác 403). */
export const useTeamMembers = (teamId: string | null, query: { page: number; limit: number; q?: string }): QueryState<Paginated<TeamMember>> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const { page, limit, q } = query;
  return useMemo(() => {
    if (!teamId) return done(EMPTY_PAGE<TeamMember>(limit));
    if (!canViewTeamMembers(actor, teamId)) return failed(EMPTY_PAGE<TeamMember>(limit), FORBIDDEN);
    const result = listTeamMembers(state, teamId, { page, limit, q });
    return result ? done(result) : failed(EMPTY_PAGE<TeamMember>(limit), { statusCode: 404, errorCode: 'RESOURCE_NOT_FOUND', message: 'Không tìm thấy nhóm.' });
  }, [state, actor, teamId, page, limit, q]);
};

/** `GET /crm/deleted-customers` (Quản trị) — khách đã xóa mềm. */
export const useDeletedCustomers = (query: DeletedCustomerQuery, isEnabled = true): QueryState<Paginated<DeletedCustomerItem>> => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const { page, limit, q } = query;
  return useMemo(
    () => (isEnabled ? done(listDeletedCustomers(state, actor, { page, limit, q })) : done(EMPTY_PAGE<DeletedCustomerItem>(limit))),
    [state, actor, page, limit, q, isEnabled],
  );
};

/** `GET /crm/projects?isDeleted=true` (Quản trị) — dự án đã xóa mềm. */
export const useDeletedProjects = (isEnabled = true) => {
  const { catalogs } = useCrmRawState();
  return useMemo(() => done(isEnabled ? catalogs.projects.filter((project) => project.deletedAt) : []), [catalogs.projects, isEnabled]);
};

// ---------------------------------------------------------------------------------------------------------------------
// Hàm ghi
// ---------------------------------------------------------------------------------------------------------------------

/** Hàm ghi (tên theo endpoint tài liệu 05) — bất đồng bộ, trả `ApiResult`. Actor đọc LÚC GỌI (đổi tài khoản mẫu có hiệu lực ngay). */
export const useCrmApi = (): CrmApi => {
  const store = useCrmStore();
  const getActor = useCallback((): CrmActor => {
    const { users, teams } = store.getState().state;
    return resolveActor(useAuthStore.getState().user, users, teams);
  }, [store]);
  return useMemo(
    () =>
      createCrmWriteApi({
        getState: () => store.getState().state,
        dispatch: (action) => store.getState().dispatch(action),
        getActor,
      }),
    [store, getActor],
  );
};
