/**
 * Hook truy cập store CRM. Màn hình (screens) CHỈ nên dùng các hook ở đây,
 * không import trực tiếp context / reducer.
 */
import { useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_VIEW } from '@crm/lib/viewHierarchy';
import { matchCrmPath } from '@crm/routes';
import type { ViewId } from '@crm/types/app';
import type { CrmActions } from './crmActions';
import { CrmActionsContext, CrmStateContext } from './crmContext';
import type { CrmState } from './crmReducer';
import {
  selectCareLogsByCustomer,
  selectCustomerById,
  selectFilteredCustomers,
  selectPendingTaskCount,
  selectSelectedCustomer,
  selectTaskGroups,
} from './selectors';

export const useCrmState = (): CrmState => {
  const state = useContext(CrmStateContext);
  if (!state) throw new Error('useCrmState phải được dùng bên trong <CrmProvider>.');
  return state;
};

export const useCrmActions = (): CrmActions => {
  const actions = useContext(CrmActionsContext);
  if (!actions) throw new Error('useCrmActions phải được dùng bên trong <CrmProvider>.');
  return actions;
};

/** Màn CRM hiện tại, suy ra từ URL (react-router). Ngoài route CRM trả DEFAULT_VIEW. */
export const useCurrentView = (): ViewId => {
  const { pathname } = useLocation();
  return matchCrmPath(pathname)?.view ?? DEFAULT_VIEW;
};

export const useSelectedCustomer = () => selectSelectedCustomer(useCrmState());

export const useCustomer = (customerId: string | null | undefined) => selectCustomerById(useCrmState(), customerId);

/** Nhật ký của khách (mặc định: khách đang chọn), mới nhất trước. */
export const useCustomerCareLogs = (customerId?: string) => {
  const state = useCrmState();
  const targetId = customerId ?? selectSelectedCustomer(state)?.id;
  return useMemo(() => selectCareLogsByCustomer(state, targetId), [state, targetId]);
};

export const useTaskGroups = () => {
  const state = useCrmState();
  return useMemo(() => selectTaskGroups(state), [state]);
};

export const usePendingTaskCount = () => selectPendingTaskCount(useCrmState());

export const useFilteredCustomers = () => {
  const state = useCrmState();
  return useMemo(() => selectFilteredCustomers(state), [state]);
};
