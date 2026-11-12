import apiAxios from './axios';
import type { LoginResponse, MeResponse, RefreshResponse } from '../types/user';
import { clearPushRegistration, readPushSubscriptionId } from '../pwa/pushStorage';

/**
 * Gọi `POST /auth/login`.
 * Backend set httpOnly cookie (refresh token) qua Set-Cookie — browser tự lưu với `withCredentials`.
 * Trả về access token (lưu trong Zustand) + user.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiAxios.post<LoginResponse>('/auth/login', {
    email: email.trim().toLowerCase(),
    password,
  });
  return data;
}

/**
 * Gọi `POST /auth/refresh` (dùng httpOnly cookie, không cần Bearer).
 * Thường được axios interceptor gọi nội bộ khi gặp 401 — export để tái dùng nếu cần.
 */
export async function refresh(): Promise<RefreshResponse> {
  const { data } = await apiAxios.post<RefreshResponse>('/auth/refresh');
  return data;
}

/**
 * Gọi `POST /auth/logout`. Backend revoke refresh token trong DB + clear cookie.
 * Idempotent: token không tồn tại cũng không throw.
 * Có id subscription push đã lưu (T-40, FR-01) thì gửi kèm `{ pushSubscriptionId }` để server thu hồi đúng thiết bị này
 * (không có thì body rỗng, hành vi như cũ). Bản ghi cục bộ luôn được xóa, kể cả khi gọi lỗi, để lần đăng nhập sau làm tươi ngay.
 */
export async function logout(): Promise<void> {
  const pushSubscriptionId = readPushSubscriptionId();
  try {
    await apiAxios.post<{ message: string }>('/auth/logout', pushSubscriptionId ? { pushSubscriptionId } : undefined);
  } finally {
    clearPushRegistration();
  }
}

/**
 * Gọi `GET /auth/me`. Dùng cho app init sau khi mount để khôi phục phiên
 * (browser vẫn còn refresh cookie → interceptor tự refresh nếu access token hết hạn).
 */
export async function getMe(): Promise<MeResponse> {
  const { data } = await apiAxios.get<MeResponse>('/auth/me');
  return data;
}
