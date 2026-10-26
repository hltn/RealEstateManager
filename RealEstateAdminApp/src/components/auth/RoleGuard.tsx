import type { ReactNode } from 'react';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { CRM_DEFAULT_PATH } from '@crm/routes';
import RedirectWithNotice from './RedirectWithNotice';
import { UserRole } from '../../types/user';
import { useAuth } from '../../hooks/useAuth';

interface RoleGuardProps {
  /** Danh sách role được phép xem nội dung. */
  allowedRoles: UserRole[];
  /** Nội dung chỉ render khi user có role đủ. */
  children: ReactNode;
  /** (Tuỳ chọn) nội dung thay thế khi không đủ quyền — mặc định null. */
  fallback?: ReactNode;
}

/**
 * Ẩn/hiện element theo role — dùng cho cả route lẫn menu item.
 * Nếu user chưa có role hoặc role không nằm trong allowedRoles → render fallback (mặc định ẩn).
 */
const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, children, fallback = null }) => {
  const { user } = useAuth();

  if (!user || !allowedRoles.includes(user.role)) {
    // MANAGER/STAFF chỉ dùng CRM: gõ URL trang tin tức/quản trị thì chuyển về màn CRM mặc định (UX; backend vẫn 403).
    if (user && (user.role === UserRole.MANAGER || user.role === UserRole.STAFF) && CRM_FEATURE_FLAGS.isPrototypeEnabled) {
      return <RedirectWithNotice to={CRM_DEFAULT_PATH} />;
    }
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default RoleGuard;
