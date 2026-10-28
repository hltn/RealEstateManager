/**
 * Kiểu dữ liệu Auth/User dùng chung cho toàn bộ frontend admin app.
 * Sync với backend: UserRole enum trong `RealEstateBackendApp/src/common/enums/user-role.enum.ts`.
 * KHÔNG đổi contract với backend — chỉ mirror những field backend trả ra (mục 6 arch doc).
 *
 * Lưu ý: dùng `as const` object + type alias thay vì `enum` vì tsconfig bật
 * `erasableSyntaxOnly` (cấm syntax enum) — giá trị vẫn tương thích string với backend.
 */

/** Role người dùng — đồng bộ với backend UserRole enum. */
export const UserRole = {
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  /** Quản lý nhóm CRM (backend `UserRole.MANAGER`). */
  MANAGER: 'MANAGER',
  /** Nhân viên kinh doanh CRM (backend `UserRole.STAFF`). */
  STAFF: 'STAFF',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Trạng thái tài khoản — đồng bộ với backend UserStatus enum. */
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * Thông tin user công khai (không chứa password).
 * Shape của `user` trong response `/auth/login` và `GET /auth/me`.
 * `/auth/me` trả thêm `status` (mục 6.1 arch doc).
 */
export interface AuthUser {
  _id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status?: UserStatus;
  /** Nhóm của người dùng (CRM). Chỉ có ở `GET /auth/me`; `null` = chưa thuộc nhóm. */
  teamId?: string | null;
  /** Các nhóm người này là Quản lý. Chỉ có ở `GET /auth/me`. */
  managedTeamIds?: string[];
}

/** Response body của `POST /auth/login`. */
export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/** Response body của `POST /auth/refresh`. */
export interface RefreshResponse {
  accessToken: string;
}

/** Response body của `GET /auth/me`. */
export type MeResponse = AuthUser;

/**
 * Kiểu dữ liệu cho bảng User Management (`GET /users`).
 * Backend trả các field này cho mỗi item trong `data`.
 */
export interface UserListItem {
  _id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

/** Payload tạo user mới (`POST /users`). */
export interface CreateUserPayload {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
}

/** Payload sửa thông tin tài khoản (`PATCH /users/:id`) — ít nhất 1 trường, chỉ gửi trường thực sự đổi. */
export interface UpdateUserPayload {
  displayName?: string;
  email?: string;
}
