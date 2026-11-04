/**
 * Hook chạy trên store MOCK cho phần của giai đoạn 2 (M8) chưa có API: Báo cáo (dashboard), xuất file, nhập file.
 * Chỉ dùng khi bật cờ `VITE_CRM_MOCK_REPORTS` / `VITE_CRM_MOCK_IMPORT_EXPORT` (xem `config/featureFlags.ts`);
 * dữ liệu là DỮ LIỆU MẪU trong trình duyệt, KHÔNG phải dữ liệu thật của hệ thống. Gỡ file này khi M8 xong.
 */
import { useCallback, useMemo } from 'react';
import { useCrmRawState, useCrmStore } from '@crm/store/hooks';
import { selectCurrentUser } from '@crm/store/selectors';
import { buildActor, type CrmActor } from './access';
import { getDashboardReport, type DashboardQuery } from './dashboard';
import type { CustomerExportFile } from './exports';
import { createMockCrmApi, type MockCrmApi } from './mockCrmApi';
import { lookupPhone } from './queries';
import type { ApiResult, CustomerListQuery } from './types';

/** Actor của người dùng MẪU trong store mock. */
export const useMockActor = (): CrmActor => {
  const { users, teams, session } = useCrmRawState();
  const currentUserId = session.currentUserId;
  return useMemo(() => buildActor(selectCurrentUser({ users, session: { currentUserId } }), teams), [users, teams, currentUserId]);
};

/** Danh mục + người dùng MẪU (dùng cho màn Báo cáo mock). */
export const useMockCatalogs = () => {
  const state = useCrmRawState();
  return { catalogs: state.catalogs, users: state.users, teams: state.teams, settings: state.settings };
};

export const useMockCrmApi = (): MockCrmApi => {
  const store = useCrmStore();
  return useMemo(() => createMockCrmApi({ getState: () => store.getState().state, dispatch: (action) => store.getState().dispatch(action) }), [store]);
};

/** `GET /crm/dashboard/*` (mock) — số liệu báo cáo theo phạm vi quyền + bộ lọc trên dữ liệu mẫu. */
export const useDashboardReport = (query: DashboardQuery) => {
  const state = useCrmRawState();
  const actor = useMockActor();
  const queryKey = JSON.stringify(query);
  return useMemo(() => ({ data: getDashboardReport(state, actor, JSON.parse(queryKey) as DashboardQuery), isLoading: false }), [state, actor, queryKey]);
};

/** `POST /crm/customer-exports` (mô phỏng) trên dữ liệu mẫu. */
export const useCustomerExport = () => {
  const api = useMockCrmApi();
  return useCallback((query: CustomerListQuery): ApiResult<CustomerExportFile> => api.createCustomerExport(query), [api]);
};

/** Kiểm "SĐT này đã có trong dữ liệu mẫu?" khi kiểm file nhập (mock). */
export const useMockPhoneExists = (): ((phone: string) => boolean) => {
  const state = useCrmRawState();
  const actor = useMockActor();
  return useCallback((phone: string) => lookupPhone(state, actor, phone)?.exists ?? false, [state, actor]);
};
