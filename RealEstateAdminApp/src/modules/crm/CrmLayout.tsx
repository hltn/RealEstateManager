/**
 * Layout route `/crm` — nằm BÊN TRONG `AppLayout` của Admin (sidebar + header + vùng nội dung giữ nguyên).
 * - Bọc `CrmProvider` (store CRM + điều hướng).
 * - Chặn màn không đủ quyền theo vai trò (02 §3, §10): chuyển về màn mặc định thay vì hiện trang trống.
 * - `GlobalModals`: Ghi chú nhanh / Lightbox / Bộ lọc nâng cao (Gọi/Zalo trong app chỉ khi bật cờ tính năng).
 * - Mobile < 768px: thêm `CrmBottomNav` + padding đáy để nội dung không bị che (trừ màn chi tiết/form).
 * - Bộ chuyển "đăng nhập giả" chỉ hiện ở môi trường dev (`import.meta.env.DEV`).
 */
import { Navigate, Outlet } from 'react-router-dom';
import { CrmBottomNav } from './components/CrmBottomNav';
import { DevUserSwitcher } from './components/DevUserSwitcher';
import { GlobalModals } from './components/GlobalModals';
import { getMobileChrome } from './lib/viewHierarchy';
import { canAccessView } from './navigation';
import { CRM_DEFAULT_PATH } from './routes';
import { CrmProvider, useCurrentUser, useCurrentView } from './store';

const CrmLayoutContent = () => {
  const currentView = useCurrentView();
  const { role } = useCurrentUser();
  const shouldShowBottomNav = getMobileChrome(currentView) === 'tabs';

  if (!canAccessView(currentView, role)) return <Navigate to={CRM_DEFAULT_PATH} replace />;

  return (
    <>
      {import.meta.env.DEV && <DevUserSwitcher />}
      {/* pb-20 = 64px thanh đáy + 16px khoảng thở; từ md trở lên không có thanh đáy */}
      <div className={shouldShowBottomNav ? 'pb-20 md:pb-0' : undefined}>
        <Outlet />
      </div>
      {shouldShowBottomNav && <CrmBottomNav />}
      <GlobalModals />
    </>
  );
};

export const CrmLayout = () => (
  <CrmProvider>
    <CrmLayoutContent />
  </CrmProvider>
);

export default CrmLayout;
