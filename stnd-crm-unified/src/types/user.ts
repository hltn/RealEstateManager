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
  /** Role cao nhất (trường suy ra, giữ để tương thích ngược). */
  role: UserRole;
  /**
   * Mọi role của tài khoản (backend trả ở `/auth/login`, `/auth/me`). Thiếu (backend cũ/dữ liệu cũ) thì suy ra từ `role`:
   * dùng `rolesOf(user)` thay vì đọc trực tiếp. Quyền là HỢP của mọi role (STAFF và EDITOR cùng có hiệu lực).
   */
  roles?: UserRole[];
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
  /** Role cao nhất (trường suy ra, giữ để tương thích ngược). */
  role: UserRole;
  /** Mọi role của tài khoản (≥1). Quyền theo role cao nhất ADMIN > MANAGER > STAFF; STAFF và EDITOR ngang nhau. */
  roles: UserRole[];
  /** Mọi nhóm của tài khoản (rỗng nếu không có MANAGER/STAFF). Gán nhóm làm ở Cài đặt CRM. */
  teamIds?: string[];
  status: UserStatus;
}

/**
 * Payload tạo user mới (`POST /users`). Chỉ gửi `roles[]` (không gửi kèm `role` đơn để khỏi lệch → 400).
 * Nhóm gán ở Cài đặt CRM nên màn này không gửi `teamIds`.
 */
export interface CreateUserPayload {
  email: string;
  password: string;
  displayName: string;
  roles: UserRole[];
}

/** Payload sửa thông tin tài khoản (`PATCH /users/:id`) — ít nhất 1 trường, chỉ gửi trường thực sự đổi. */
export interface UpdateUserPayload {
  displayName?: string;
  email?: string;
}
