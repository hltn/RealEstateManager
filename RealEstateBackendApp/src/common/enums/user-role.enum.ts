/**
 * Vai trò người dùng trong hệ thống RBAC.
 * - ADMIN: toàn quyền (write/delete/publish + quản lý user).
 * - EDITOR: chỉ đọc dữ liệu (xem bài viết, raw articles).
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
}
