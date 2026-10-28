import apiAxios from './axios';
import type {
  CreateUserPayload,
  UpdateUserPayload,
  UserListItem,
  UserRole,
  UserStatus,
} from '../types/user';
import type { PaginatedResponse } from '../types/pagination';

/**
 * Lấy danh sách user có phân trang — `GET /users?page=&limit=` (ADMIN only).
 * Trả đúng shape `{ data, meta }` (mục 6.2 arch doc).
 */
export async function fetchUsers(
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<PaginatedResponse<UserListItem>> {
  const { data } = await apiAxios.get<PaginatedResponse<UserListItem>>('/users', {
    params: { page, limit },
    signal,
  });
  return data;
}

/** Tạo user mới — `POST /users` (ADMIN only). Trả user đã tạo (không chứa password). */
export async function createUser(payload: CreateUserPayload): Promise<UserListItem> {
  const { data } = await apiAxios.post<UserListItem>('/users', {
    ...payload,
    email: payload.email.trim().toLowerCase(),
  });
  return data;
}

/** Đổi trạng thái Active/Block — `PATCH /users/:id/status` (ADMIN only, không block chính mình). */
export async function updateUserStatus(
  id: string,
  status: UserStatus,
): Promise<UserListItem> {
  const { data } = await apiAxios.patch<UserListItem>(`/users/${id}/status`, { status });
  return data;
}

/** Đổi role — `PATCH /users/:id/role` (ADMIN only). */
export async function updateUserRole(
  id: string,
  role: UserRole,
): Promise<UserListItem> {
  const { data } = await apiAxios.patch<UserListItem>(`/users/${id}/role`, { role });
  return data;
}

/**
 * Sửa tên hiển thị / email — `PATCH /users/:id` (ADMIN only, ít nhất 1 trường).
 * Email trùng → 409. Trả user đã cập nhật (cùng shape route status/role).
 */
export async function updateUser(
  id: string,
  payload: UpdateUserPayload,
): Promise<UserListItem> {
  const body: UpdateUserPayload = { ...payload };
  if (body.email !== undefined) body.email = body.email.trim().toLowerCase();
  if (body.displayName !== undefined) body.displayName = body.displayName.trim();
  const { data } = await apiAxios.patch<UserListItem>(`/users/${id}`, body);
  return data;
}

/**
 * Đặt lại mật khẩu — `PATCH /users/:id/password` (ADMIN only).
 * Sau khi đặt lại, các phiên đăng nhập của tài khoản đó bị thu hồi.
 */
export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  await apiAxios.patch(`/users/${id}/password`, { newPassword });
}
