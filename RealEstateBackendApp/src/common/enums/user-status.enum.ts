/**
 * Trạng thái tài khoản người dùng.
 * - ACTIVE: được phép đăng nhập.
 * - BLOCKED: bị cấm đăng nhập (login trả 403).
 */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
}
