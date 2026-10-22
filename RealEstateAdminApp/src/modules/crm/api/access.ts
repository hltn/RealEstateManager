/**
 * Phân quyền theo vai trò + phạm vi khách (X1, QT6 — tài liệu 04 §4.1–4.3), mô phỏng `CustomerAccessService`.
 * Áp ở LỚP TRUY CẬP DỮ LIỆU (mọi truy vấn khách đi qua `canAccessCustomer`), không chỉ ẩn nút trên UI.
 * Khách ngoài phạm vi được coi như không tồn tại (backend trả 404 `CUSTOMER_NOT_FOUND`).
 */
import { getPrimaryUserId, isInCareTeam } from '@crm/lib/customerRules';
import type { CrmUser, Customer, Team, UserRole } from '@crm/types/crm';
import type { CustomerPermissions } from './types';

/** `CrmActor` của 04 §4.3. */
export interface CrmActor {
  userId: string;
  role: UserRole;
  teamId: string | null;
  /** Các nhóm người này là quản lý (`teams.managerIds` chứa mình). */
  managedTeamIds: string[];
}

export const buildActor = (user: CrmUser, teams: readonly Team[]): CrmActor => ({
  userId: user.id,
  role: user.role,
  teamId: user.teamId,
  managedTeamIds: teams.filter((team) => team.managerIds.includes(user.id)).map((team) => team.id),
});

const usersByIdCache = new WeakMap<readonly CrmUser[], ReadonlyMap<string, CrmUser>>();

/** Map id -> user, cache theo tham chiếu mảng `users` (tránh `users.find` O(n) cho từng khách khi lọc danh sách — TB8). */
export const getUsersById = (users: readonly CrmUser[]): ReadonlyMap<string, CrmUser> => {
  let map = usersByIdCache.get(users);
  if (!map) {
    map = new Map(users.map((user) => [user.id, user]));
    usersByIdCache.set(users, map);
  }
  return map;
};

/**
 * `customers.teamIds` (04 §3.2): hợp các nhóm của thành viên nhóm chăm sóc; nhóm chăm sóc rỗng -> nhóm của người tạo.
 */
export const getCustomerTeamIds = (customer: Pick<Customer, 'careTeam' | 'createdBy'>, users: readonly CrmUser[]): string[] => {
  const usersById = getUsersById(users);
  const memberIds = customer.careTeam.length > 0 ? customer.careTeam.map((member) => member.userId) : [customer.createdBy];
  return [...new Set(memberIds.map((userId) => usersById.get(userId)?.teamId).filter((teamId): teamId is string => Boolean(teamId)))];
};

/**
 * Phạm vi xem (QT6): Quản trị xem tất cả; Quản lý xem khách của nhóm mình quản lý hoặc mình trong nhóm chăm sóc;
 * Nhân viên chỉ xem khách có mình trong nhóm chăm sóc.
 */
export const canAccessCustomer = (actor: CrmActor, customer: Pick<Customer, 'careTeam' | 'createdBy'>, users: readonly CrmUser[]): boolean => {
  if (actor.role === 'ADMIN') return true;
  if (isInCareTeam(customer.careTeam, actor.userId)) return true;
  if (actor.role === 'MANAGER') {
    const teamIds = getCustomerTeamIds(customer, users);
    return teamIds.some((teamId) => actor.managedTeamIds.includes(teamId));
  }
  return false;
};

/** Quyền thao tác trên 1 khách (ma trận 04 §4.2) — chỉ gọi khi đã `canAccessCustomer`. */
export const getCustomerPermissions = (actor: CrmActor, customer: Pick<Customer, 'careTeam'>): CustomerPermissions => {
  const isAdminOrManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const isPrimary = getPrimaryUserId(customer.careTeam) === actor.userId;
  return {
    canEdit: true,
    canManageCareTeam: isAdminOrManager || isPrimary,
    canChangePrimary: isAdminOrManager,
    canDelete: isAdminOrManager,
    canRevealNationalId: isAdminOrManager || isPrimary,
    canReviewJoinRequests: isAdminOrManager || isPrimary,
  };
};

/** Menu/màn theo vai trò (tài liệu 02 §3): Báo cáo cho Quản lý/Quản trị; Cài đặt + Dự án cho Quản trị. */
export const canViewReports = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
export const canViewSettings = (role: UserRole): boolean => role === 'ADMIN';
export const canViewProjectCatalog = (role: UserRole): boolean => role === 'ADMIN';
/** Thêm/sửa/xoá dự án (04 §4.2, X7): chỉ Quản trị. */
export const canManageProjects = (role: UserRole): boolean => role === 'ADMIN';
/** Xuất danh sách (X8, 04 §4.2): Quản trị, Quản lý. */
export const canExportCustomers = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
/** Nhập dữ liệu (X8): chỉ Quản trị. */
export const canImportCustomers = (role: UserRole): boolean => role === 'ADMIN';
/** Phân người chăm sóc hàng loạt: Quản trị, Quản lý. */
export const canBulkAssign = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
