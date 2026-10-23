/**
 * Vai trò người dùng trong hệ thống RBAC.
 * - ADMIN: toàn quyền (write/delete/publish + quản lý user) — cũng là "Quản trị" của CRM.
 * - EDITOR: chỉ đọc dữ liệu (xem bài viết, raw articles). KHÔNG có quyền CRM.
 * - MANAGER: Quản lý nhóm trong CRM (tài liệu 04 mục 4.1) — giá trị mới, tương thích ngược.
 * - STAFF: Nhân viên chăm sóc khách trong CRM — giá trị mới, tương thích ngược.
 *
 * Chỉ THÊM giá trị enum, không đổi/xóa giá trị cũ: dữ liệu `users` hiện có (ADMIN/EDITOR) giữ nguyên.
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  MANAGER = 'MANAGER',
  STAFF = 'STAFF',
}

/** Vai trò được vào các route CRM (`@Roles(...CRM_ROLES)`); EDITOR bị chặn. */
export const CRM_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STAFF,
];

/** Vai trò có thể được phân chăm sóc khách / thuộc một nhóm (ADMIN không bị phân, EDITOR ngoài CRM). */
export const CRM_TEAM_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.STAFF,
];
