/**
 * Hook React của lớp truy cập dữ liệu CRM — ĐIỂM NỐI DUY NHẤT giữa UI và nguồn dữ liệu.
 * Hiện chạy trên store mock (đồng bộ). Khi có backend: thay thân hook bằng React Query (`useQuery`/`useMutation`)
 * gọi `httpCrmApi`, giữ nguyên chữ ký `{ data, isLoading }` + các hàm của `useCrmApi()` -> UI không sửa.
 */
import { useCallback, useMemo } from 'react';
import type { CatalogKind } from '@crm/store/crmReducer';
import { useCrmRawState, useCrmStore } from '@crm/store/hooks';
import { selectCurrentUser } from '@crm/store/selectors';
import { isValidPhone } from '@crm/lib/phone';
import { listProjectFilterOptions, type ProjectFilterOption } from '@crm/lib/projectRules';
import { buildActor, type CrmActor } from './access';
import { countCatalogUsage } from './catalogAdmin';
import { getDashboardReport, type DashboardQuery } from './dashboard';
import { listDailyTasks } from './dailyTasks';
import type { CustomerExportFile } from './exports';
import { createMockCrmApi, type CrmApi } from './mockCrmApi';
import {
  getCustomer,
  getCustomerPersona,
  getListCounts,
  listAppointments,
  listAssignableUsers,
  listCareLogs,
  listCareTeamRequests,
  listCustomers,
  listHistories,
  listNationalIdViews,
  lookupPhone,
} from './queries';
import type { ApiResult, AppointmentListQuery, CustomerListQuery, DailyTaskQuery } from './types';

export interface QueryState<T> {
  data: T;
  /** Luôn false với mock đồng bộ; giữ để UI đã có nhánh Skeleton khi chuyển React Query. */
  isLoading: boolean;
}

const done = <T>(data: T): QueryState<T> => ({ data, isLoading: false });

/** Hàm ghi dữ liệu (tên theo endpoint tài liệu 05). */
export const useCrmApi = (): CrmApi => {
  const store = useCrmStore();
  return useMemo(
    () =>
      createMockCrmApi({
        getState: () => store.getState().state,
        dispatch: (action) => store.getState().dispatch(action),
      }),
    [store],
  );
};

/** Actor (người dùng hiện tại + nhóm quản lý) để kiểm quyền ở UI (ẩn nút không đủ quyền — 02 §10). */
export const useCrmActor = (): CrmActor => {
  const { users, teams, session } = useCrmRawState();
  const currentUserId = session.currentUserId;
  // Chỉ tính lại khi người dùng/nhóm/phiên đổi — KHÔNG đổi tham chiếu mỗi khi dữ liệu khách thay đổi (TB8).
  return useMemo(() => buildActor(selectCurrentUser({ users, session: { currentUserId } }), teams), [users, teams, currentUserId]);
};

/** Danh mục + người dùng (tải 1 lần — 04 §7.6). */
export const useCatalogs = () => {
  const state = useCrmRawState();
  return { catalogs: state.catalogs, users: state.users, teams: state.teams, settings: state.settings };
};

/**
 * Lựa chọn dự án cho ô lọc: dự án đang hoạt động + dự án đã ngừng nhưng còn khách gắn (đánh dấu "ngừng"); loại dự án xoá mềm.
 */
export const useProjectFilterOptions = (): ProjectFilterOption[] => {
  const { catalogs, customers } = useCrmRawState();
  return useMemo(() => {
    const referenced = new Set(customers.flatMap((customer) => customer.interestedProjectIds));
    return listProjectFilterOptions(catalogs.projects, referenced);
  }, [catalogs.projects, customers]);
};

/** Hàm kiểm "SĐT này đã có khách?" (qua `lookupPhone`, không lộ danh sách SĐT) — dùng khi kiểm file nhập. */
export const usePhoneExists = (): ((phone: string) => boolean) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useCallback((phone: string) => lookupPhone(state, actor, phone)?.exists ?? false, [state, actor]);
};

/** `POST /crm/customers/phone-lookups` (X2) dạng truy vấn phản ứng theo state: tự cập nhật khi đề nghị tham gia đổi. */
export const usePhoneLookup = (phone: string, excludeCustomerId?: string) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => (isValidPhone(phone) ? lookupPhone(state, actor, phone, excludeCustomerId) : null), [state, actor, phone, excludeCustomerId]);
};

/** `GET /crm/customers` */
export const useCustomerList = (query: CustomerListQuery) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => done(listCustomers(state, actor, JSON.parse(queryKey) as CustomerListQuery)), [state, actor, queryKey]);
};

/** `GET /crm/customers/list-counts` */
export const useListCounts = (query: CustomerListQuery) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => done(getListCounts(state, actor, JSON.parse(queryKey) as CustomerListQuery)), [state, actor, queryKey]);
};

/** `GET /crm/customers/:id` — null = không tồn tại hoặc ngoài phạm vi (UI hiện "Không tìm thấy"). */
export const useCustomerDetail = (customerId: string | null | undefined) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(getCustomer(state, actor, customerId)), [state, actor, customerId]);
};

/** `GET /crm/customers/:id/persona` */
export const useCustomerPersona = (customerId: string | null | undefined) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(getCustomerPersona(state, actor, customerId)), [state, actor, customerId]);
};

/** `GET /crm/customers/:id/care-logs` */
export const useCareLogs = (customerId: string | null | undefined) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(listCareLogs(state, actor, customerId)), [state, actor, customerId]);
};

/** `GET /crm/customers/:id/histories` */
export const useCustomerHistories = (customerId: string | null | undefined) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(listHistories(state, actor, customerId)), [state, actor, customerId]);
};

/** `GET /crm/customers/:id/national-id-views` */
export const useNationalIdViews = (customerId: string | null | undefined) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(listNationalIdViews(state, actor, customerId)), [state, actor, customerId]);
};

/** `GET /crm/appointments` */
export const useAppointments = (query: AppointmentListQuery = {}) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => done(listAppointments(state, actor, JSON.parse(queryKey) as AppointmentListQuery)), [state, actor, queryKey]);
};

/** `GET /crm/daily-tasks` — tính theo ngày thực tại thời điểm render. */
export const useDailyTasks = (query: DailyTaskQuery = {}) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const { scope, q } = query;
  return useMemo(() => done(listDailyTasks(state, actor, { scope, q })), [state, actor, scope, q]);
};

/** `GET /crm/care-team-requests` */
export const useCareTeamRequests = (box: 'mine' | 'to-review') => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(listCareTeamRequests(state, actor, box)), [state, actor, box]);
};

/** `GET /crm/assignable-users` */
export const useAssignableUsers = () => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  return useMemo(() => done(listAssignableUsers(state, actor)), [state, actor]);
};

/** `POST /crm/customer-exports` (mô phỏng): dựng CSV theo bộ lọc + phạm vi quyền hiện tại tại thời điểm gọi. */
export const useCustomerExport = () => {
  const api = useCrmApi();
  return useCallback((query: CustomerListQuery): ApiResult<CustomerExportFile> => api.createCustomerExport(query), [api]);
};

/** `GET /crm/dashboard/*` — số liệu báo cáo theo phạm vi quyền + bộ lọc. */
export const useDashboardReport = (query: DashboardQuery) => {
  const state = useCrmRawState();
  const actor = useCrmActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => done(getDashboardReport(state, actor, JSON.parse(queryKey) as DashboardQuery)), [state, actor, queryKey]);
};

/** Số khách đang dùng từng mục danh mục (cảnh báo trước khi ẩn — X7). */
export const useCatalogUsage = (kind: CatalogKind) => {
  const state = useCrmRawState();
  return useMemo(() => {
    const items = state.catalogs[kind] as readonly { id: string }[];
    return done(new Map(items.map((item) => [item.id, countCatalogUsage(state, kind, item.id)])));
  }, [state, kind]);
};
