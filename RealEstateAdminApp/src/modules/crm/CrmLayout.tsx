/**
 * Layout route `/crm` — nằm BÊN TRONG `AppLayout` của Admin (sidebar + header + vùng nội dung giữ nguyên).
 * - Bọc `CrmProvider` (store CRM cần react-router để điều hướng).
 * - `GlobalModals`: modal Gọi / Zalo / Ghi chú nhanh / Lightbox / Bộ lọc nâng cao của CRM.
 * - Mobile < 768px: thêm `CrmBottomNav` + padding đáy để nội dung không bị che (trừ màn chi tiết/form).
 */
import { Outlet } from 'react-router-dom';
import { CrmBottomNav } from './components/CrmBottomNav';
import { GlobalModals } from './components/GlobalModals';
import { getMobileChrome } from './lib/viewHierarchy';
import { CrmProvider, useCurrentView } from './store';

const CrmLayoutContent = () => {
  const currentView = useCurrentView();
  const shouldShowBottomNav = getMobileChrome(currentView) === 'tabs';

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

export const CrmLayout = () => (
  <CrmProvider>
    <CrmLayoutContent />
  </CrmProvider>
);

export default CrmLayout;
