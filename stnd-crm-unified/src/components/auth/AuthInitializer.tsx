import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../../api/auth.api';
import { useAuth } from '../../hooks/useAuth';

/**
 * Bootstrap auth khi app mount: gọi `GET /auth/me` đúng 1 lần để khôi phục phiên
 * (refresh cookie httpOnly còn hiệu lực → axios interceptor tự refresh access token).
 *
 * Dùng React Query (KHÔNG dùng useEffect để gọi API theo chuẩn project).
 * - Thành công: đổ user vào store + đánh dấu đã init.
 * - Thất bại: clearAuth + đánh dấu đã init → ProtectedRoute sẽ soft-redirect về `/login`.
 *
 * Chỉ chạy 1 lần (enabled khi chưa init, staleTime Infinity, retry false).
 */
const AuthInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isInitialized, setUser, clearAuth, markInitialized } = useAuth();

  const { data, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    enabled: !isInitialized,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Sync kết quả vào store (đây là state-sync, không phải gọi API).
  useEffect(() => {
    if (!isInitialized && (data || error)) {
      if (data) {
        setUser(data);
      } else {
        clearAuth();
      }
      markInitialized();
    }
  }, [data, error, isInitialized, setUser, clearAuth, markInitialized]);

  return <>{children}</>;
};

export default AuthInitializer;
