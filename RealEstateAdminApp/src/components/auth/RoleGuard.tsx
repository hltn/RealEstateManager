import type { ReactNode } from 'react';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { CRM_DEFAULT_PATH } from '@crm/routes';
import RedirectWithNotice from './RedirectWithNotice';
import type { UserRole } from '../../types/user';
import { useAuth } from '../../hooks/useAuth';
import { hasAnyRole, hasTeamRole, rolesOf } from '../../utils/userRoles';

interface RoleGuardProps {
  /** Danh sách role được phép xem nội dung (user có ÍT NHẤT MỘT role khớp là được). */
  allowedRoles: UserRole[];
  /** Nội dung chỉ render khi user có role đủ. */
  children: ReactNode;
  /** (Tuỳ chọn) nội dung thay thế khi không đủ quyền — mặc định null. */
  fallback?: ReactNode;
}

/**
 * Ẩn/hiện element theo role — dùng cho cả route lẫn menu item.
 * Nếu user chưa đăng nhập hoặc không có role nào nằm trong allowedRoles → render fallback (mặc định ẩn).
 */
const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, children, fallback = null }) => {
  const { user } = useAuth();

  if (!user || !hasAnyRole(user, allowedRoles)) {
    // MANAGER/STAFF chỉ dùng CRM: gõ URL trang tin tức/quản trị thì chuyển về màn CRM mặc định (UX; backend vẫn 403).
    if (user && hasTeamRole(rolesOf(user)) && CRM_FEATURE_FLAGS.isPrototypeEnabled) {
      return <RedirectWithNotice to={CRM_DEFAULT_PATH} />;
    }
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default RoleGuard;
