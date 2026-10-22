/**
 * Hook truy cập store CRM. Màn hình dùng hook ở đây (UI state) + `@crm/api` (dữ liệu nghiệp vụ),
 * không import trực tiếp context / reducer / store.
 */
import { useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from 'zustand';
import { DEFAULT_VIEW } from '@crm/lib/viewHierarchy';
import { matchCrmPath } from '@crm/routes';
import type { ViewId } from '@crm/types/app';
import type { CrmUser } from '@crm/types/crm';
import type { CrmActions } from './crmActions';
import { CrmActionsContext, CrmStoreContext } from './crmContext';
import type { CrmState } from './crmReducer';
import { getDefaultCrmStore, type CrmStore } from './crmStore';
import { selectCurrentUser } from './selectors';

/** Store đang dùng: store của CrmProvider gần nhất, ngoài provider (vd AppSidebar) dùng store chung. */
export const useCrmStore = (): CrmStore => useContext(CrmStoreContext) ?? getDefaultCrmStore();

/** State CRM; trên route theo khách, `selectedCustomerId` = id trong URL (URL là nguồn sự thật). */
export const useCrmState = (): CrmState => {
  const state = useStore(useCrmStore(), (shape) => shape.state);
  const { pathname } = useLocation();
  const routeCustomerId = matchCrmPath(pathname)?.customerId ?? null;
  return useMemo(() => (routeCustomerId ? { ...state, selectedCustomerId: routeCustomerId } : state), [state, routeCustomerId]);
};

/** State thô không phụ thuộc router (dùng được ngoài `<CrmProvider>`/router, vd menu trái). */
export const useCrmRawState = (): CrmState => useStore(useCrmStore(), (shape) => shape.state);

export const useCrmActions = (): CrmActions => {
  const actions = useContext(CrmActionsContext);
  if (!actions) throw new Error('useCrmActions phải được dùng bên trong <CrmProvider>.');
  return actions;
};

/** Màn CRM hiện tại, suy ra từ URL. Ngoài route CRM trả DEFAULT_VIEW. */
export const useCurrentView = (): ViewId => {
  const { pathname } = useLocation();
  return matchCrmPath(pathname)?.view ?? DEFAULT_VIEW;
};

/** Người dùng đang đăng nhập (mock) — dùng được cả ngoài `<CrmProvider>`. */
export const useCurrentUser = (): CrmUser => selectCurrentUser(useCrmRawState());
