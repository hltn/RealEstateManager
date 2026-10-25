import { create } from 'zustand';
import { queryClient } from '../queryClient';
import type { AuthUser } from '../types/user';

/**
 * Auth state toàn cục — Access Token lưu RAM (Zustand), Refresh Token lưu httpOnly cookie
 * (browser tự gửi kèm qua `withCredentials`).
 *
 * Quy tắc: KHÔNG lưu refresh token ở đây — chỉ backend (httpOnly cookie) nắm giữ.
 */
export interface AuthState {
  /** Access token (JWT) — gắn vào header `Authorization` bởi axios interceptor. */
  accessToken: string | null;

  /** Thông tin user đang đăng nhập (đổ ra UI/menu). */
  user: AuthUser | null;

  /**
   * Cờ đánh dấu app đã chạy xong `GET /auth/me` lần đầu sau khi mount.
   * Dùng để ProtectedRoute không redirect nhầm khi đang tải lại trang (refresh cookie còn hiệu lực).
   */
  isInitialized: boolean;

  /** Ghi nhận access token + user sau khi login/refresh thành công. */
  setAuth: (token: string, user: AuthUser) => void;

  /** Chỉ cập nhật user (dùng cho `GET /auth/me` khi token đã do interceptor set). */
  setUser: (user: AuthUser) => void;

  /** Xoá toàn bộ auth (logout / refresh fail) — ép user về `/login`. */
  clearAuth: () => void;

  /** Đánh dấu đã chạy xong init check (dù thành hay thất bại). */
  markInitialized: () => void;
}

/** Đổi sang tài khoản khác (không qua đăng xuất): xóa cache. Cùng tài khoản (refresh token) thì giữ nguyên. */
const clearCacheIfUserChanged = (previous: AuthUser | null, next: AuthUser): void => {
  if (previous && previous._id !== next._id) queryClient.clear();
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isInitialized: false,

  setAuth: (token, user) => {
    clearCacheIfUserChanged(useAuthStore.getState().user, user);
    set({ accessToken: token, user });
  },

  setUser: (user) => {
    clearCacheIfUserChanged(useAuthStore.getState().user, user);
    set({ user });
  },

  clearAuth: () => {
    // Đăng xuất / refresh thất bại: xóa cache dữ liệu (CRM có PII) để người dùng sau không thấy dữ liệu của người trước.
    queryClient.clear();
    set({ accessToken: null, user: null, isInitialized: true });
  },

  markInitialized: () => set({ isInitialized: true }),
}));
