/**
 * Hook chạy trên store MOCK cho phần của giai đoạn 2 (M8) chưa có API: Báo cáo (dashboard), xuất file, nhập file.
 * Dùng khi cờ `isMockReportsEnabled` / `isMockImportExportEnabled` bật (prototype: luôn bật, xem `config/featureFlags.ts`);
 * dữ liệu là DỮ LIỆU MẪU trong trình duyệt, KHÔNG phải dữ liệu thật của hệ thống. Gỡ file này khi M8 xong.
 */
import { useCallback, useMemo } from 'react';
import { useCrmRawState, useCrmStore } from '@crm/store/hooks';
import { type CrmActor } from './access';
import { resolveActor } from './actor';
import { useCrmActor } from './hooks';
import { useAuthStore } from '../../../stores/auth.store';
import { getDashboardReport, type DashboardQuery } from './dashboard';
import type { CustomerExportFile } from './exports';
import { createMockCrmApi, type MockCrmApi } from './mockCrmApi';
import { lookupPhone } from './queries';
import type { ApiResult, CustomerListQuery } from './types';

/** Actor của tài khoản mẫu đang đăng nhập ([Prototype] cùng nguồn với `useCrmActor`: `auth.store` + hồ sơ ở store CRM). */
export const useMockActor = (): CrmActor => useCrmActor();

/** Danh mục + người dùng MẪU (dùng cho màn Báo cáo mock). */
export const useMockCatalogs = () => {
  const state = useCrmRawState();
  return { catalogs: state.catalogs, users: state.users, teams: state.teams, settings: state.settings };
};

export const useMockCrmApi = (): MockCrmApi => {
  const store = useCrmStore();
  return useMemo(
    () =>
      createMockCrmApi({
        getState: () => store.getState().state,
        dispatch: (action) => store.getState().dispatch(action),
        getActor: () => resolveActor(useAuthStore.getState().user, store.getState().state.users, store.getState().state.teams),
      }),
    [store],
  );
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
