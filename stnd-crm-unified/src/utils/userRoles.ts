/**
 * Quy tắc nhiều role của một tài khoản (đồng bộ `RealEstateBackendApp/src/common/utils/user-roles.util.ts`).
 * - Role cao nhất ADMIN > MANAGER > STAFF > EDITOR quyết định `role` đại diện; STAFF và EDITOR ngang quyền (hợp quyền).
 * - Chỉ tài khoản có MANAGER hoặc STAFF mới có nhóm; mất cả hai thì backend xóa mọi nhóm.
 */
import { UserRole } from '../types/user';

export const ROLE_PRECEDENCE: readonly UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF, UserRole.EDITOR];

/** Lựa chọn vai trò cho ô chọn nhiều, theo thứ tự quyền (STAFF và EDITOR ngang nhau, cùng có hiệu lực). */
export const ROLE_OPTIONS: readonly { value: UserRole; label: string }[] = ROLE_PRECEDENCE.map((value) => ({ value, label: value }));

/** Khử trùng + sắp theo ROLE_PRECEDENCE; giá trị lạ bị bỏ. */
export const normalizeRoles = (roles: readonly string[]): UserRole[] => ROLE_PRECEDENCE.filter((role) => roles.includes(role));

/** Role cao nhất; `null` nếu không có role hợp lệ. */
export const highestRole = (roles: readonly string[]): UserRole | null => normalizeRoles(roles)[0] ?? null;

/** Role hiệu lực của bản ghi: ưu tiên `roles[]`, bản ghi cũ chỉ có `role` đơn thì coi như `[role]`. */
export const rolesOf = (source: { role?: string | null; roles?: readonly string[] | null }): UserRole[] =>
  normalizeRoles(source.roles && source.roles.length > 0 ? source.roles : source.role ? [source.role] : []);

/** Có role được thuộc nhóm làm việc CRM (MANAGER/STAFF). */
export const hasTeamRole = (roles: readonly string[]): boolean => roles.includes(UserRole.MANAGER) || roles.includes(UserRole.STAFF);

/** Nguồn role của một tài khoản đăng nhập (đủ cho `AuthUser`, `UserListItem`; có thể chưa đăng nhập). */
type RoleSource = { role?: string | null; roles?: readonly string[] | null } | null | undefined;

/**
 * Có ÍT NHẤT MỘT role nằm trong `allowed` (quyền là hợp của mọi role; backend `RolesGuard` cũng cho phép nếu bất kỳ role khớp).
 * Chưa đăng nhập -> false.
 */
export const hasAnyRole = (source: RoleSource, allowed: readonly string[]): boolean => rolesOf(source ?? {}).some((role) => allowed.includes(role));

/** Có role dùng được module CRM (ADMIN/MANAGER/STAFF). EDITOR thuần không có (backend 403 mọi route CRM). */
export const hasCrmRole = (source: RoleSource): boolean => hasAnyRole(source, [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]);

/** Có role dùng được phần tin tức/Prompt (ADMIN/EDITOR). */
export const hasNewsRole = (source: RoleSource): boolean => hasAnyRole(source, [UserRole.ADMIN, UserRole.EDITOR]);

/** Tài khoản CHỈ dùng CRM: có MANAGER/STAFF mà không có ADMIN/EDITOR (backend 403 các route tin tức) -> ẩn menu/redirect khỏi trang tin tức. */
export const isCrmOnlyAccount = (source: RoleSource): boolean => hasAnyRole(source, [UserRole.MANAGER, UserRole.STAFF]) && !hasNewsRole(source);

/** Role CRM đại diện (quyền theo role cao nhất ADMIN > MANAGER > STAFF; EDITOR/không rõ coi như STAFF). */
export const crmRoleOf = (source: RoleSource): 'ADMIN' | 'MANAGER' | 'STAFF' => {
  const highest = highestRole(rolesOf(source ?? {}));
  return highest === UserRole.ADMIN || highest === UserRole.MANAGER ? highest : UserRole.STAFF;
};

/** Cập nhật vai trò vào user đăng nhập: `roles` đã chuẩn hóa + `role` = role cao nhất (giữ nguyên role cũ nếu `roles` rỗng). */
export const withRoles = <T extends { role: UserRole; roles?: UserRole[] }>(user: T, roles: readonly string[]): T => {
  const normalized = normalizeRoles(roles);
  return { ...user, role: normalized[0] ?? user.role, roles: normalized };
};

/** Hai danh sách có cùng tập phần tử (bỏ qua thứ tự). */
export const isSameSet = (first: readonly string[], second: readonly string[]): boolean =>
  first.length === second.length && first.every((item) => second.includes(item));
