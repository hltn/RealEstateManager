import { useAuthStore } from '../stores/auth.store';

/**
 * Wrapper hook cho auth store — tập trung mọi state auth vào 1 entry point,
 * tránh component nhiều nơi import trực tiếp store (giảm coupling).
 */
export function useAuth() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const setAuth = useAuthStore((state) => state.setAuth);
  const setUser = useAuthStore((state) => state.setUser);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const markInitialized = useAuthStore((state) => state.markInitialized);

  return {
    accessToken,
    user,
    isInitialized,
    isAuthenticated: Boolean(accessToken) && Boolean(user),
    setAuth,
    setUser,
    clearAuth,
    markInitialized,
  };
}
