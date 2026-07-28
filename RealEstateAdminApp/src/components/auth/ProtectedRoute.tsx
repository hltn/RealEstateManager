import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Chặn truy cập route bảo vệ: redirect về `/login` nếu chưa đăng nhập.
 * Trong khi app init chưa xong (đang gọi `/auth/me`) thì hiển thị spinner full-screen
 * để tránh nháy trang login khi refresh cookie vẫn còn hiệu lực.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isInitialized } = useAuth();
  const location = useLocation();

  if (!isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Giữ lại location định tới để sau khi login có thể redirect lại (nếu cần).
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
