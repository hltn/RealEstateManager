import type { ReactNode } from 'react';
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
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default RoleGuard;
