/**
 * Layout route `/crm` — nằm BÊN TRONG `AppLayout` của Admin (sidebar + header + vùng nội dung giữ nguyên).
 * - Bọc `CrmProvider` (trạng thái giao diện: bộ lọc, modal, điều hướng).
 * - Chặn vai trò không có quyền CRM (EDITOR) và màn không đủ quyền theo vai trò (02 §3, §10) — chỉ là UX, backend mới quyết định.
 * - Tải danh mục 1 lần (04 §7.6) trước khi hiện màn: Skeleton khi đang tải, thông báo + nút thử lại khi lỗi (403/503/mạng...).
 * - `GlobalModals`: Ghi chú nhanh / Lightbox / Bộ lọc nâng cao (Gọi/Zalo trong app chỉ khi bật cờ tính năng).
 * - Đổi màn (đổi pathname, không phải Back/Forward) thì cuộn về đầu trang.
 * - Mobile < 768px: thêm `CrmBottomNav` + padding đáy để nội dung không bị che (trừ màn chi tiết/form).
 */
import { Outlet } from 'react-router-dom';
import { useCatalogs } from '@crm/api';
import RedirectWithNotice from '../../components/auth/RedirectWithNotice';
import { useAuthStore } from '../../stores/auth.store';
import { CrmBottomNav } from './components/CrmBottomNav';
import { CrmUnavailable } from './components/CrmUnavailable';
import { GlobalModals } from './components/GlobalModals';
import { useScrollToTopOnPathChange } from './hooks/useScrollToTopOnPathChange';
import { getMobileChrome } from './lib/viewHierarchy';
import { canAccessView } from './navigation';
import { CRM_DEFAULT_PATH } from './routes';
import { ScreenSkeleton } from './screens/ScreenSkeleton';
import { CrmProvider, useCurrentUser, useCurrentView } from './store';

const CrmLayoutContent = () => {
  useScrollToTopOnPathChange();
  const currentView = useCurrentView();
  const { role } = useCurrentUser();
  const { isLoading, isError, error, refetch } = useCatalogs();
  const shouldShowBottomNav = getMobileChrome(currentView) === 'tabs';

  // Ngoài quyền thì chuyển về màn mặc định KÈM thông báo giải thích (không chuyển hướng im lặng).
  if (!canAccessView(currentView, role)) return <RedirectWithNotice to={CRM_DEFAULT_PATH} />;
  if (isError) return <CrmUnavailable error={error} onRetry={refetch} />;
  if (isLoading) return <ScreenSkeleton variant="desktop" />;

  return (
    <>
      {/* pb-20 = 64px thanh đáy + 16px khoảng thở; từ md trở lên không có thanh đáy */}
      <div className={shouldShowBottomNav ? 'pb-20 md:pb-0' : undefined}>
        <Outlet />
      </div>
      {shouldShowBottomNav && <CrmBottomNav />}
      <GlobalModals />
    </>
  );
};

/** EDITOR (tài khoản tin tức) không có quyền CRM: backend trả 403 mọi route CRM, nên chặn sớm ở giao diện. */
const CrmRoleGate = () => {
  const role = useAuthStore((state) => state.user?.role);
  if (role === 'EDITOR') return <CrmUnavailable error={{ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Tài khoản của bạn không có quyền sử dụng module Quản lý khách hàng.' }} />;
  return <CrmLayoutContent />;
};

export const CrmLayout = () => (
  <CrmProvider>
    <CrmRoleGate />
  </CrmProvider>
);

export default CrmLayout;
