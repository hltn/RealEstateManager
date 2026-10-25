/**
 * Hook React của lớp truy cập dữ liệu CRM — ĐIỂM NỐI giữa UI và API thật (React Query: cache, loading, race condition).
 * Chữ ký `{ data, isLoading }` giữ như bản mock để UI không phải đổi; thêm `error`/`isError`/`refetch` cho trạng thái lỗi.
 * Báo cáo, nhập/xuất (phase 2, M8) vẫn dùng mock có cờ ở `mockHooks.ts`.
 */
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useAuthStore } from '../../../stores/auth.store';
import { useDebouncedValue } from '@crm/hooks/useDebouncedValue';
import { isValidPhone } from '@crm/lib/phone';
import { includesVietnamese } from '@crm/lib/text';
import { listProjectFilterOptions, type ProjectFilterOption } from '@crm/lib/projectRules';
import type { CrmCatalogs, CrmSettings, CrmUser, PersonaFieldDefinition, Team, UserRole } from '@crm/types/crm';
import type { CrmActor } from './access';
import * as admin from './http/adminApi';
import * as catalogApi from './http/catalogApi';
import { hashFingerprint, toResult } from './http/crmHttp';
import { isNotFoundError, toApiError } from './http/crmErrors';
import type { DetailMappingContext } from './http/customerMappers';
import * as care from './http/careApi';
import * as customerApi from './http/customerApi';
import * as scheduling from './http/schedulingApi';
import { createHttpCrmApi, type CrmApi } from './httpCrmApi';
import type {
  ApiError,
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
  HistoryEntry,
  ListCounts,
  NationalIdViewEntry,
  Paginated,
  PhoneLookupResult,
} from './types';
import { addDaysToDateKey, getVnTodayKey } from '@crm/lib/dateTime';

export interface QueryState<T> {
  data: T;
  isLoading: boolean;
  /** Đang tải lại ở nền (đổi trang/bộ lọc) — dữ liệu cũ vẫn hiển thị. */
  isFetching: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/** Khóa query: `catalogs` ít đổi; `data` làm mới sau mỗi thao tác ghi. */
export const crmKeys = {
  catalogs: ['crm', 'catalogs'] as const,
  data: ['crm', 'data'] as const,
};

const CATALOG_STALE_MS = 5 * 60 * 1000;
const DATA_STALE_MS = 15 * 1000;
const NOTIFICATION_POLL_MS = 60 * 1000;

/** Không thử lại 4xx (kết quả cuối), chỉ thử lại lỗi mạng/5xx tối đa 2 lần. */
const retryTransient = (failureCount: number, error: unknown): boolean => {
  const apiError = toApiError(error);
  const isTransient = apiError.statusCode === 0 || apiError.statusCode >= 500;
  return isTransient && failureCount < 2;
};

const stateOf = <T>(query: { data: T | undefined; isLoading: boolean; isFetching: boolean; isError: boolean; error: unknown; refetch: () => unknown }, fallback: T): QueryState<T> => ({
  data: query.data ?? fallback,
  isLoading: query.isLoading,
  isFetching: query.isFetching,
  isError: query.isError,
  error: query.isError ? toApiError(query.error) : null,
  refetch: () => void query.refetch(),
});

// ---------------------------------------------------------------------------------------------------------------------
// Người dùng hiện tại + quyền
// ---------------------------------------------------------------------------------------------------------------------

const toCrmRole = (role: string | undefined): UserRole => (role === 'ADMIN' || role === 'MANAGER' ? role : 'STAFF');

/** Actor (người dùng đăng nhập thật + nhóm quản lý) để ẩn nút theo quyền (UX; backend mới là nguồn sự thật). Ổn định tham chiếu. */
export const useCrmActor = (): CrmActor => {
  const user = useAuthStore((state) => state.user);
  const userId = user?._id ?? '';
  const role = toCrmRole(user?.role);
  const teamId = user?.teamId ?? null;
  const managedKey = (user?.managedTeamIds ?? []).join(',');
  return useMemo(() => ({ userId, role, teamId, managedTeamIds: managedKey ? managedKey.split(',') : [] }), [userId, role, teamId, managedKey]);
};

// ---------------------------------------------------------------------------------------------------------------------
// Danh mục (tải 1 lần — 04 §7.6)
// ---------------------------------------------------------------------------------------------------------------------

const catalogQuery = <T,>(key: string, queryFn: (signal: AbortSignal) => Promise<T>, enabled = true) => ({
  queryKey: [...crmKeys.catalogs, key],
  queryFn: ({ signal }: { signal: AbortSignal }) => queryFn(signal),
  staleTime: CATALOG_STALE_MS,
  retry: retryTransient,
  refetchOnWindowFocus: false,
  enabled,
});

const EMPTY_CATALOGS: CrmCatalogs = { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] };
const EMPTY_FIELDS: PersonaFieldDefinition[] = [];
const EMPTY_USERS: CrmUser[] = [];
const EMPTY_TEAMS: (Team & { code: string; memberCount: number; isActive: boolean })[] = [];

/** Danh mục + người dùng + nhóm + cấu hình chân dung. `isLoading` = còn danh mục bắt buộc chưa tải xong. */
export const useCatalogs = () => {
  const actor = useCrmActor();
  const authUser = useAuthStore((state) => state.user);
  const canSeeTeams = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const statuses = useQuery(catalogQuery('statuses', catalogApi.fetchStatuses));
  const leadSources = useQuery(catalogQuery('lead-sources', catalogApi.fetchLeadSources));
  const areas = useQuery(catalogQuery('areas', catalogApi.fetchAreas));
  const contactResults = useQuery(catalogQuery('contact-results', catalogApi.fetchContactResults));
  const projects = useQuery(catalogQuery('projects', (signal) => catalogApi.fetchProjects({}, signal)));
  const tags = useQuery(catalogQuery('tags', catalogApi.fetchTags));
  const personaFields = useQuery(catalogQuery('persona-fields', catalogApi.fetchPersonaFields));
  const assignable = useQuery(catalogQuery('assignable-users', catalogApi.fetchAssignableUsers));
  const teams = useQuery(catalogQuery('teams', catalogApi.fetchTeams, canSeeTeams));
  const settings = useQuery(catalogQuery('settings', catalogApi.fetchCrmSettings, canSeeTeams));

  const required = [statuses, leadSources, areas, contactResults, projects, tags, personaFields, assignable];
  const firstError = required.find((query) => query.isError);

  const catalogs = useMemo<CrmCatalogs>(
    () =>
      statuses.data && leadSources.data && areas.data && projects.data && tags.data && contactResults.data
        ? { statuses: statuses.data, leadSources: leadSources.data, areas: areas.data, projects: projects.data, tags: tags.data, contactResults: contactResults.data }
        : EMPTY_CATALOGS,
    [statuses.data, leadSources.data, areas.data, projects.data, tags.data, contactResults.data],
  );

  /** Người phân chăm sóc được + bản thân (để tên mình luôn tra được). */
  const users = useMemo<CrmUser[]>(() => {
    const base = assignable.data ?? EMPTY_USERS;
    if (!authUser || base.some((user) => user.id === authUser._id)) return base;
    return [...base, { id: authUser._id, fullName: authUser.displayName, displayName: authUser.displayName, role: toCrmRole(authUser.role), jobTitle: '', teamId: authUser.teamId ?? null, isActive: true }];
  }, [assignable.data, authUser]);

  const refetch = () => required.forEach((query) => void query.refetch());

  return {
    catalogs,
    users,
    teams: teams.data ?? EMPTY_TEAMS,
    settings: (settings.data ?? null) as CrmSettings | null,
    personaFields: personaFields.data ?? EMPTY_FIELDS,
    isLoading: required.some((query) => query.isLoading),
    isError: Boolean(firstError),
    error: firstError ? toApiError(firstError.error) : null,
    refetch,
  };
};

/** Map `fieldKey` -> định nghĩa trường (để đổi mã/nhãn lựa chọn). */
export const usePersonaFieldMap = (): ReadonlyMap<string, PersonaFieldDefinition> => {
  const { personaFields } = useCatalogs();
  return useMemo(() => new Map(personaFields.map((field) => [field.key, field])), [personaFields]);
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
  const { users, isLoading, isError, error, refetch } = useCatalogs();
  const data = useMemo(
    () =>
      users
        .filter((user) => user.role !== 'ADMIN')
        .map((user) => ({ id: user.id, displayName: user.displayName, fullName: user.fullName, role: user.role, team: user.teamId ? { id: user.teamId, label: user.teamName ?? '' } : null })),
    [users],
  );
  return { data, isLoading, isFetching: false, isError, error, refetch };
};

// ---------------------------------------------------------------------------------------------------------------------
// Ngữ cảnh ánh xạ chi tiết khách
// ---------------------------------------------------------------------------------------------------------------------

/** Ngữ cảnh gắn quyền duyệt/chức danh khi map chi tiết khách (đọc mới nhất qua ref, không làm đổi khóa query). */
const useDetailContext = (): (() => DetailMappingContext) => {
  const actor = useCrmActor();
  const { users } = useCatalogs();
  const ref = useRef<DetailMappingContext>({ actor: { userId: actor.userId, role: actor.role } });
  ref.current = { actor: { userId: actor.userId, role: actor.role }, roleOf: (userId) => users.find((user) => user.id === userId)?.role };
  return useCallback(() => ref.current, []);
};

// ---------------------------------------------------------------------------------------------------------------------
// Khách hàng
// ---------------------------------------------------------------------------------------------------------------------

const EMPTY_PAGE = <T,>(): Paginated<T> => ({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
const EMPTY_LIST_COUNTS: ListCounts = { ALL: 0, NOT_CONTACTED: 0, INTERESTED: 0, NET: 0, DROPPED: 0, byStatus: [] };

/** Từ khóa gõ dở (<2 ký tự) coi như chưa tìm; debounce để không vượt hạn mức tìm kiếm 30 lần/phút (05 §2.3). */
const useDebouncedQuery = (query: CustomerListQuery): CustomerListQuery => {
  const debouncedQ = useDebouncedValue(query.q ?? '', 400);
  const isTypingSearch = (query.q ?? '') !== debouncedQ;
  return useMemo(() => ({ ...query, q: isTypingSearch ? debouncedQ : query.q }), [query, debouncedQ, isTypingSearch]);
};

/** `GET /crm/customers` */
export const useCustomerList = (query: CustomerListQuery): QueryState<Paginated<CustomerListItem>> => {
  const effective = useDebouncedQuery(query);
  const key = JSON.stringify(effective);
  const result = useQuery({
    queryKey: [...crmKeys.data, 'customers', key],
    queryFn: ({ signal }) => customerApi.fetchCustomerList(effective, signal),
    placeholderData: keepPreviousData,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, EMPTY_PAGE());
};

/** `GET /crm/customers/list-counts` */
export const useListCounts = (query: CustomerListQuery): QueryState<ListCounts> => {
  const effective = useDebouncedQuery(query);
  const key = JSON.stringify({ ...effective, page: undefined, limit: undefined, sort: undefined, listGroup: undefined });
  const result = useQuery({
    queryKey: [...crmKeys.data, 'list-counts', key],
    queryFn: ({ signal }) => customerApi.fetchListCounts(effective, signal),
    placeholderData: keepPreviousData,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, EMPTY_LIST_COUNTS);
};

/** `GET /crm/customers/:id` — `data` null khi đang tải hoặc 404 (ngoài phạm vi); phân biệt bằng `isLoading`/`isNotFound`. */
export const useCustomerDetail = (customerId: string | null | undefined): QueryState<CustomerDetail | null> & { isNotFound: boolean } => {
  const getContext = useDetailContext();
  const result = useQuery({
    queryKey: [...crmKeys.data, 'customer', customerId],
    queryFn: ({ signal }) => customerApi.fetchCustomerDetail(customerId as string, getContext(), signal),
    enabled: Boolean(customerId),
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  const state = stateOf(result, null);
  return { ...state, isNotFound: Boolean(state.error && isNotFoundError(state.error)) };
};

/** `GET /crm/customers/:id/persona` */
export const useCustomerPersona = (customerId: string | null | undefined): QueryState<CustomerPersonaView | null> => {
  const fieldMap = usePersonaFieldMap();
  const fieldMapRef = useRef(fieldMap);
  fieldMapRef.current = fieldMap;
  const hasFields = fieldMap.size > 0;
  const result = useQuery({
    queryKey: [...crmKeys.data, 'persona', customerId],
    queryFn: ({ signal }) => customerApi.fetchCustomerPersona(customerId as string, fieldMapRef.current, signal),
    enabled: Boolean(customerId) && hasFields,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, null);
};

const CARE_LOG_PAGE_SIZE = 20;

/** `GET /crm/customers/:id/care-logs` — tải dần (mới nhất trước); `isPrimaryAuthor` theo phụ trách chính hiện tại. */
export const useCareLogs = (customerId: string | null | undefined, primaryUserId: string | null = null) => {
  const result = useInfiniteQuery({
    queryKey: [...crmKeys.data, 'care-logs', customerId, primaryUserId],
    queryFn: ({ pageParam, signal }) => customerApi.fetchCareLogs(customerId as string, { page: pageParam, limit: CARE_LOG_PAGE_SIZE }, primaryUserId, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    enabled: Boolean(customerId),
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  const data = useMemo<CareLogView[]>(() => result.data?.pages.flatMap((page) => page.data) ?? [], [result.data]);
  return {
    ...stateOf({ ...result, data }, [] as CareLogView[]),
    hasMore: Boolean(result.hasNextPage),
    isFetchingMore: result.isFetchingNextPage,
    loadMore: () => void result.fetchNextPage(),
  };
};

/** `GET /crm/customers/:id/histories` (50 mục mới nhất). */
export const useCustomerHistories = (customerId: string | null | undefined): QueryState<HistoryEntry[]> => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'histories', customerId],
    queryFn: async ({ signal }) => (await customerApi.fetchHistories(customerId as string, { limit: 50 }, signal)).data,
    enabled: Boolean(customerId),
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, []);
};

/** `GET /crm/customers/:id/national-id-views` — chỉ Quản trị/Quản lý (`isEnabled`). */
export const useNationalIdViews = (customerId: string | null | undefined, isEnabled = true): QueryState<NationalIdViewEntry[]> => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'national-id-views', customerId],
    queryFn: async ({ signal }) => (await customerApi.fetchNationalIdViews(customerId as string, signal)).data,
    enabled: Boolean(customerId) && isEnabled,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, []);
};

/**
 * `POST /crm/customers/phone-lookups` (X2): kiểm trùng SĐT. SĐT nằm trong body (không lên URL/log). Hạn mức 30/phút/người nên
 * chỉ tra khi SĐT hợp lệ, đã debounce; 429 -> không có kết quả (UI vẫn cho nhập, backend chặn trùng khi lưu).
 */
export const usePhoneLookup = (phone: string, excludeCustomerId?: string): PhoneLookupResult | null => {
  const debouncedPhone = useDebouncedValue(phone, 500);
  const isReady = isValidPhone(debouncedPhone) && debouncedPhone === phone;
  const result = useQuery({
    // Khóa dùng bản băm: SĐT thô không nằm trong khóa cache/devtools.
    queryKey: [...crmKeys.data, 'phone-lookup', hashFingerprint(debouncedPhone)],
    queryFn: ({ signal }) => customerApi.postPhoneLookup(debouncedPhone, signal),
    enabled: isReady,
    staleTime: 20 * 1000,
    gcTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!isReady || !result.data) return null;
  // Tra ra chính khách đang sửa (SĐT không đổi) không phải là trùng.
  if (excludeCustomerId && result.data.customerId === excludeCustomerId) return null;
  return result.data;
};

// ---------------------------------------------------------------------------------------------------------------------
// Nhóm chăm sóc, lịch hẹn, việc hôm nay
// ---------------------------------------------------------------------------------------------------------------------

/** `GET /crm/care-team-requests` (đang chờ duyệt). Trả thêm map `requestId -> customerId` để lọc theo khách. */
export const useCareTeamRequests = (box: 'mine' | 'to-review', isEnabled = true): QueryState<(CareTeamRequestView & { customerId: string })[]> => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'care-team-requests', box],
    queryFn: async ({ signal }) => {
      const { items, customerIds } = await care.fetchCareTeamRequests(box, signal);
      return items.map((item) => ({ ...item, customerId: customerIds.get(item.id) ?? item.customer?.id ?? '' }));
    },
    enabled: isEnabled,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, []);
};

/** Cửa sổ mặc định khi màn không chỉ định: 14 ngày trước tới 45 ngày sau (≤ 62 ngày theo 05 §2.9). */
export const getDefaultAppointmentWindow = (now: Date = new Date()): { from: string; to: string } => {
  const today = getVnTodayKey(now);
  return { from: addDaysToDateKey(today, -14), to: addDaysToDateKey(today, 45) };
};

/** `GET /crm/appointments` (gom trang). */
export const useAppointments = (query: AppointmentListQuery = {}): QueryState<AppointmentView[]> => {
  const defaults = useMemo(() => getDefaultAppointmentWindow(), []);
  const effective = { ...query, from: query.from ?? defaults.from, to: query.to ?? defaults.to };
  const key = JSON.stringify(effective);
  const result = useQuery({
    queryKey: [...crmKeys.data, 'appointments', key],
    queryFn: ({ signal }) => scheduling.fetchAppointments(effective, signal),
    placeholderData: keepPreviousData,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, []);
};

const toSearchable = (task: DailyTask): string => `${task.customer.fullName} ${task.title} ${task.suggestion}`;

/** `GET /crm/daily-tasks` (cả 3 nhóm). `q` lọc phía giao diện (API không có tham số tìm). */
export const useDailyTasks = (query: DailyTaskQuery = {}): QueryState<DailyTask[]> => {
  const { scope, q } = query;
  const result = useQuery({
    queryKey: [...crmKeys.data, 'daily-tasks', scope ?? 'mine'],
    queryFn: ({ signal }) => scheduling.fetchDailyTasks({ scope }, signal),
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  const tasks = useMemo(() => {
    const all = result.data ?? [];
    return q && q.trim() ? all.filter((task) => includesVietnamese(toSearchable(task), q)) : all;
  }, [result.data, q]);
  return stateOf({ ...result, data: tasks }, [] as DailyTask[]);
};

/** `GET /crm/daily-tasks/summary` — số việc mỗi nhóm cho badge tab. */
export const useDailyTaskSummary = (scope?: 'mine' | 'team') => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'daily-task-summary', scope ?? 'mine'],
    queryFn: ({ signal }) => scheduling.fetchDailyTaskSummary(scope, signal),
    staleTime: DATA_STALE_MS,
    refetchInterval: NOTIFICATION_POLL_MS,
    retry: retryTransient,
  });
  return stateOf(result, { overdue: 0, today: 0, upcoming: 0 });
};

// ---------------------------------------------------------------------------------------------------------------------
// Thông báo trong app
// ---------------------------------------------------------------------------------------------------------------------

/** `GET /notifications/unread-count` — làm mới định kỳ (chưa có push, M7). */
export const useUnreadNotificationCount = (isEnabled = true): number => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'notifications', 'unread-count'],
    queryFn: ({ signal }) => scheduling.fetchUnreadCount(signal),
    enabled: isEnabled,
    refetchInterval: NOTIFICATION_POLL_MS,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return result.data ?? 0;
};

/** `GET /notifications` */
export const useNotifications = (query: { isRead?: boolean; page?: number; limit?: number } = {}, isEnabled = true) => {
  const key = JSON.stringify(query);
  const result = useQuery({
    queryKey: [...crmKeys.data, 'notifications', 'list', key],
    queryFn: ({ signal }) => scheduling.fetchNotifications(query, signal),
    enabled: isEnabled,
    placeholderData: keepPreviousData,
    refetchInterval: NOTIFICATION_POLL_MS,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, EMPTY_PAGE<scheduling.NotificationItem>());
};

// ---------------------------------------------------------------------------------------------------------------------
// Quản trị
// ---------------------------------------------------------------------------------------------------------------------

/** `GET /users` (Quản trị). */
export const useAdminUsers = (isEnabled = true): QueryState<CrmUser[]> => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'admin-users'],
    queryFn: ({ signal }) => admin.fetchAllUsers(signal),
    enabled: isEnabled,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, EMPTY_USERS);
};

/** `GET /crm/projects?isDeleted=true` (Quản trị) — dự án đã xóa mềm. */
export const useDeletedProjects = (isEnabled = true) => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'deleted-projects'],
    queryFn: ({ signal }) => catalogApi.fetchProjects({ isDeleted: true }, signal),
    enabled: isEnabled,
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, [] as Awaited<ReturnType<typeof catalogApi.fetchProjects>>);
};

/** `GET /crm/projects` kèm `customerCount` (số khách quan tâm) cho trang Dự án. */
export const useProjectsWithCounts = (): QueryState<Map<string, number>> => {
  const result = useQuery({
    queryKey: [...crmKeys.data, 'project-counts'],
    queryFn: async ({ signal }) => {
      const rows = await catalogApi.fetchAllPages<{ id: string; customerCount: number }>('/crm/projects', {}, signal);
      return new Map(rows.map((row) => [row.id, row.customerCount]));
    },
    staleTime: DATA_STALE_MS,
    retry: retryTransient,
  });
  return stateOf(result, new Map<string, number>());
};

// ---------------------------------------------------------------------------------------------------------------------
// Hàm ghi
// ---------------------------------------------------------------------------------------------------------------------

/** Làm mới toàn bộ dữ liệu nghiệp vụ (và danh mục nếu thao tác quản trị đổi danh mục). */
export const invalidateCrm = async (queryClient: QueryClient, options: { shouldIncludeCatalogs?: boolean } = {}): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: crmKeys.data }),
    options.shouldIncludeCatalogs ? queryClient.invalidateQueries({ queryKey: crmKeys.catalogs }) : Promise.resolve(),
  ]);
};

/** Hàm ghi (tên theo endpoint tài liệu 05) — bất đồng bộ, trả `ApiResult`. */
export const useCrmApi = (): CrmApi => {
  const queryClient = useQueryClient();
  const getContext = useDetailContext();
  const fieldMap = usePersonaFieldMap();
  const fieldMapRef = useRef(fieldMap);
  fieldMapRef.current = fieldMap;
  return useMemo(
    () =>
      createHttpCrmApi({
        // Danh mục chỉ làm mới khi thao tác quản trị/thẻ mới đổi danh mục ().
        invalidate: (options) => invalidateCrm(queryClient, options),
        getContext,
        getPersonaFields: () => fieldMapRef.current,
      }),
    [queryClient, getContext],
  );
};

/**
 * Thao tác với hộp thông báo (đánh dấu đã đọc). Nhẹ: KHÔNG kéo danh mục như `useCrmApi` nên dùng được ở header của mọi trang.
 * Sau khi ghi, làm mới danh sách + số chưa đọc.
 */
export const useNotificationActions = () => {
  const queryClient = useQueryClient();
  return useMemo(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: [...crmKeys.data, 'notifications'] });
    return {
      markRead: async (id: string, isRead: boolean) => {
        const result = await toResult(() => scheduling.patchNotificationRead(id, isRead));
        if (result.ok) await refresh();
        return result;
      },
      markAllRead: async () => {
        const result = await toResult(() => scheduling.patchAllNotificationsRead());
        if (result.ok) await refresh();
        return result;
      },
    };
  }, [queryClient]);
};
