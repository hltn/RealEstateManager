import { useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getParentView } from '@crm/lib/viewHierarchy';
import { buildCrmPath, CRM_DEFAULT_PATH, matchCrmPath } from '@crm/routes';
import { createCrmActions, type CrmRouterBridge } from './crmActions';
import { CrmActionsContext, CrmStateContext } from './crmContext';
import { createInitialState, createSeedData, crmReducer, type CrmDataState, type CrmState } from './crmReducer';
import { clearCrmData, loadCrmData, saveCrmData } from './crmStorage';

export interface CrmProviderProps {
  children: ReactNode;
  /** Dữ liệu khởi tạo (story/demo). Mặc định: localStorage -> mock. */
  initialData?: CrmDataState;
  /** Có lưu dữ liệu vào localStorage không. Mặc định true. */
  shouldPersist?: boolean;
}

/** react-router lưu chỉ số entry trong `history.state.idx`; > 0 nghĩa là còn trang trước trong app. */
const hasInAppHistory = (): boolean => {
  const historyState = window.history.state as { idx?: number } | null;
  return typeof historyState?.idx === 'number' && historyState.idx > 0;
};

/**
 * Store CRM dùng chung cho desktop + mobile (React context + useReducer).
 * - PHẢI nằm bên trong `<BrowserRouter>` (đặt ở layout route `/crm` trong App.tsx).
 * - URL là nguồn sự thật cho màn hiện tại + khách đang xem: `selectedCustomerId` bị ghi đè bởi `:customerId` trên URL.
 * - Điều hướng của store đi qua `CrmRouterBridge` (useNavigate) — màn chỉ gọi `navigate(view)` / `goBack()`.
 * - State và actions tách 2 context: component chỉ cần actions sẽ không re-render khi state đổi.
 */
export const CrmProvider = ({ children, initialData, shouldPersist = true }: CrmProviderProps) => {
  const [storeState, dispatch] = useReducer(crmReducer, undefined, () => {
    const data = initialData ?? (shouldPersist ? loadCrmData() : null) ?? createSeedData();
    return createInitialState(data);
  });

  const { pathname } = useLocation();
  const routerNavigate = useNavigate();
  const routeCustomerId = matchCrmPath(pathname)?.customerId ?? null;

  // State công khai: khách trong URL (nếu có) thắng khách chọn gần nhất.
  const state = useMemo<CrmState>(
    () => (routeCustomerId ? { ...storeState, selectedCustomerId: routeCustomerId } : storeState),
    [storeState, routeCustomerId],
  );

  // Ref giữ giá trị mới nhất cho action creator (actions được memo 1 lần, không đổi identity).
  const stateRef = useRef(state);
  const pathnameRef = useRef(pathname);
  const routerNavigateRef = useRef(routerNavigate);
  useEffect(() => {
    stateRef.current = state;
    pathnameRef.current = pathname;
    routerNavigateRef.current = routerNavigate;
  }, [state, pathname, routerNavigate]);

  const actions = useMemo(() => {
    const router: CrmRouterBridge = {
      navigateTo: (path, options) => routerNavigateRef.current(path, { replace: options?.shouldReplace ?? false }),
      goBack: () => {
        if (hasInAppHistory()) {
          routerNavigateRef.current(-1);
          return;
        }
        // Mở thẳng URL (không có lịch sử) -> về màn cha theo PARENT_VIEW_BY_VIEW.
        const current = matchCrmPath(pathnameRef.current);
        const parentPath = current
          ? buildCrmPath(getParentView(current.view), current.customerId)
          : CRM_DEFAULT_PATH;
        routerNavigateRef.current(parentPath, { replace: true });
      },
    };
    return createCrmActions({
      dispatch,
      getState: () => stateRef.current,
      createSeedData,
      clearPersistedData: shouldPersist ? clearCrmData : undefined,
      router,
    });
  }, [shouldPersist]);

  // Đồng bộ dữ liệu nghiệp vụ xuống localStorage (side effect lưu trữ, không phải gọi API).
  const { customers, careLogs, appointments, tasks } = storeState;
  useEffect(() => {
    if (!shouldPersist) return;
    saveCrmData({ customers, careLogs, appointments, tasks });
  }, [customers, careLogs, appointments, tasks, shouldPersist]);

  return (
    <CrmActionsContext.Provider value={actions}>
      <CrmStateContext.Provider value={state}>{children}</CrmStateContext.Provider>
    </CrmActionsContext.Provider>
  );
};
