import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getParentView } from '@crm/lib/viewHierarchy';
import { buildCrmPath, CRM_DEFAULT_PATH, matchCrmPath } from '@crm/routes';
import { createCrmActions, type CrmRouterBridge } from './crmActions';
import { CrmActionsContext, CrmStoreContext } from './crmContext';
import { getDefaultCrmStore, subscribePersistError, type CrmStore } from './crmStore';

export interface CrmProviderProps {
  children: ReactNode;
  /** Store riêng (test/story). Mặc định: store Zustand dùng chung của ứng dụng. */
  store?: CrmStore;
}

/** react-router lưu chỉ số entry trong `history.state.idx`; > 0 nghĩa là còn trang trước trong app. */
const hasInAppHistory = (): boolean => {
  const historyState = window.history.state as { idx?: number } | null;
  return typeof historyState?.idx === 'number' && historyState.idx > 0;
};

/**
 * Cung cấp store CRM + action giao diện cho cây `/crm`.
 * - PHẢI nằm trong `<BrowserRouter>` (layout route `/crm` trong App.tsx).
 * - URL là nguồn sự thật cho khách đang xem: hook `useCrmState()` ghi đè `selectedCustomerId` bằng `:customerId`.
 */
export const CrmProvider = ({ children, store }: CrmProviderProps) => {
  const crmStore = store ?? getDefaultCrmStore();
  const { pathname } = useLocation();
  const routerNavigate = useNavigate();

  const pathnameRef = useRef(pathname);
  const routerNavigateRef = useRef(routerNavigate);
  useEffect(() => {
    pathnameRef.current = pathname;
    routerNavigateRef.current = routerNavigate;
  }, [pathname, routerNavigate]);

  const actions = useMemo(() => {
    const router: CrmRouterBridge = {
      navigateTo: (path, options) => routerNavigateRef.current(path, { replace: options?.shouldReplace ?? false }),
      goBack: () => {
        if (hasInAppHistory()) {
          routerNavigateRef.current(-1);
          return;
        }
        // Mở thẳng URL (không có lịch sử) -> về màn cha.
        const current = matchCrmPath(pathnameRef.current);
        const parentPath = current ? buildCrmPath(getParentView(current.view), current.customerId) : CRM_DEFAULT_PATH;
        routerNavigateRef.current(parentPath, { replace: true });
      },
    };
    return createCrmActions({
      dispatch: (action) => crmStore.getState().dispatch(action),
      getState: () => {
        const { state } = crmStore.getState();
        const routeCustomerId = matchCrmPath(pathnameRef.current)?.customerId ?? null;
        return routeCustomerId ? { ...state, selectedCustomerId: routeCustomerId } : state;
      },
      router,
    });
  }, [crmStore]);

  // Ghi localStorage thất bại (hết dung lượng...) -> báo rõ, không im lặng mất dữ liệu sau khi tải lại.
  useEffect(
    () =>
      subscribePersistError((reason) =>
        actions.showToast({
          type: 'error',
          title: reason === 'QUOTA' ? 'Bộ nhớ trình duyệt đã đầy' : 'Không lưu được dữ liệu',
          message:
            reason === 'QUOTA'
              ? 'Thay đổi chưa được lưu và sẽ mất khi tải lại trang. Hãy xoá bớt ảnh đính kèm hoặc dữ liệu cũ.'
              : 'Trình duyệt không cho lưu cục bộ (chế độ riêng tư?). Thay đổi sẽ mất khi tải lại trang.',
          durationMs: 8000,
        }),
      ),
    [actions],
  );

  return (
    <CrmStoreContext.Provider value={crmStore}>
      <CrmActionsContext.Provider value={actions}>{children}</CrmActionsContext.Provider>
    </CrmStoreContext.Provider>
  );
};
