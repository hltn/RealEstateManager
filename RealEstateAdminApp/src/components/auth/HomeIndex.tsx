import { Navigate } from 'react-router-dom';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { CRM_DEFAULT_PATH } from '@crm/routes';
import RawArticlesScreen from '../../screens/RawArticlesScreen';
import { useAuth } from '../../hooks/useAuth';
import { UserRole } from '../../types/user';

/**
 * Trang chủ `/`: ADMIN/EDITOR vào Raw Articles như cũ. MANAGER/STAFF (chỉ dùng CRM, backend 403 các route tin tức)
 * được chuyển tới màn CRM mặc định CHỈ KHI module CRM bật; khi tắt `/crm/*` không có route (rơi về `*` -> `/`) nên
 * chuyển hướng sẽ lặp vô hạn -> hiện thông báo thay vì chuyển hướng.
 */
const HomeIndex: React.FC = () => {
  const { user } = useAuth();
  if (user?.role === UserRole.MANAGER || user?.role === UserRole.STAFF) {
    if (CRM_FEATURE_FLAGS.isPrototypeEnabled) return <Navigate to={CRM_DEFAULT_PATH} replace />;
    return (
      <div role="status" className="flex min-h-[60vh] items-center justify-center text-gray-500">
        Tính năng chưa khả dụng hoặc bạn chưa có quyền truy cập trang này.
      </div>
    );
  }
  return <RawArticlesScreen />;
};

export default HomeIndex;
