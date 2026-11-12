import { CRM_TEAM_ROLES, UserRole } from '../enums/user-role.enum';

/**
 * Thứ tự ưu tiên trong CÙNG phân vùng quyền CRM: ADMIN > MANAGER > STAFF.
 * EDITOR thuộc phân vùng nội dung/tin tức nên đứng cuối chỉ để chọn được "role đại diện" cho tài khoản chỉ có EDITOR;
 * quyền thực tế của một tài khoản nhiều role là HỢP quyền của từng role (xem `hasAnyRole`), không phải quyền của role cao nhất.
 */
export const ROLE_PRECEDENCE: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STAFF,
  UserRole.EDITOR,
];

/** Khử trùng + sắp theo `ROLE_PRECEDENCE` (ổn định để so sánh/audit). Giá trị lạ không thuộc enum bị bỏ. */
export const normalizeRoles = (roles: readonly string[]): UserRole[] =>
  ROLE_PRECEDENCE.filter((role) => roles.includes(role));

/** Role cao nhất (ADMIN > MANAGER > STAFF > EDITOR); `null` nếu không có role hợp lệ nào. */
export const highestRole = (roles: readonly string[]): UserRole | null =>
  normalizeRoles(roles)[0] ?? null;

/**
 * Danh sách role hiệu lực của một bản ghi user/JWT payload: ưu tiên `roles[]`; bản ghi/token cũ chỉ có `role` đơn
 * thì coi như `[role]` (tương thích ngược: token cũ sống tới 15 phút, tài khoản chưa migrate).
 */
export const rolesOf = (source: {
  role?: string | null;
  roles?: readonly string[] | null;
}): string[] => {
  if (source.roles && source.roles.length > 0) return [...source.roles];
  return source.role ? [source.role] : [];
};

/** Có ít nhất một role trong `roles` nằm trong `allowed`. */
export const hasAnyRole = (
  roles: readonly string[],
  allowed: readonly string[],
): boolean => roles.some((role) => allowed.includes(role));

/** Có role được thuộc nhóm làm việc CRM (MANAGER/STAFF). */
export const hasCrmTeamRole = (roles: readonly string[]): boolean =>
  hasAnyRole(roles, CRM_TEAM_ROLES);

/** Vai trò được đứng tên người chăm sóc chính (PRIMARY) khi tạo khách: ADMIN, MANAGER, STAFF (EDITOR ngoài CRM). */
const PRIMARY_CAPABLE_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STAFF,
];

/**
 * Tài khoản có thể làm PRIMARY của khách do chính mình tạo (FR-10): mọi vai trò CRM, kể cả Admin thuần.
 * Khác `hasCrmTeamRole` (chỉ Manager/Staff, dùng cho điều kiện NGƯỜI ĐƯỢC MỜI/phân vào nhóm): Admin tự đứng tên khi tạo
 * nhưng không bị phân vào nhóm người khác.
 */
export const canBePrimary = (roles: readonly string[]): boolean =>
  hasAnyRole(roles, PRIMARY_CAPABLE_ROLES);
