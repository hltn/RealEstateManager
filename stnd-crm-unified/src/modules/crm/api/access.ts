/**
 * Phân quyền theo vai trò + phạm vi khách (X1, QT6 — tài liệu 04 §4.1–4.3), mô phỏng `CustomerAccessService`.
 * Áp ở LỚP TRUY CẬP DỮ LIỆU (mọi truy vấn khách đi qua `canAccessCustomer`), không chỉ ẩn nút trên UI.
 * Khách ngoài phạm vi được coi như không tồn tại (backend trả 404 `CUSTOMER_NOT_FOUND`).
 *
 * [Prototype] Khác bản app chính: app chính lấy quyền từ backend (`permissions` trong response); prototype tự tính ở đây theo ĐÚNG luật
 * backend (`customer-scope.ts`, `customer-delete-policy.ts`, `crm-actor.ts`): tài khoản nhiều role/nhóm, Quản lý theo `managedTeamIds`.
 */
import { getPrimaryUserId, isInCareTeam } from '@crm/lib/customerRules';
import type { CrmUser, Customer, Team, UserRole } from '@crm/types/crm';
import type { CustomerPermissions } from './types';

/** `CrmActor` của 04 §4.3. */
export interface CrmActor {
  userId: string;
  /** Vai trò CAO NHẤT (ADMIN > MANAGER > STAFF) — cơ sở của phạm vi khách. */
  role: UserRole;
  /** Nhóm chính (= `teamIds[0]`). */
  teamId: string | null;
  /** [Prototype] Mọi nhóm của người này (tài khoản nhiều nhóm). */
  teamIds: string[];
  /** Các nhóm người này là quản lý (`teams.managerIds` chứa mình); rỗng nếu không có role MANAGER. */
  managedTeamIds: string[];
}

/** Nhóm của 1 tài khoản: ưu tiên `teamIds` (nhiều nhóm), bản ghi cũ chỉ có `teamId`. */
export const teamIdsOfUser = (user: Pick<CrmUser, 'teamId'> & { teamIds?: readonly string[] }): string[] =>
  user.teamIds && user.teamIds.length > 0 ? [...user.teamIds] : user.teamId ? [user.teamId] : [];

export const buildActor = (user: CrmUser & { teamIds?: readonly string[]; roles?: readonly string[] }, teams: readonly Team[]): CrmActor => {
  const teamIds = teamIdsOfUser(user);
  const isManager = user.isActive && (user.roles ? user.roles.includes('MANAGER') : user.role === 'MANAGER');
  return {
    userId: user.id,
    role: user.role,
    teamId: teamIds[0] ?? null,
    teamIds,
    managedTeamIds: isManager ? teams.filter((team) => team.managerIds.includes(user.id)).map((team) => team.id) : [],
  };
};

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
 * [Prototype] Người nhiều nhóm đóng góp mọi nhóm của họ (backend `teamIdsOf(user)`).
 */
export const getCustomerTeamIds = (customer: Pick<Customer, 'careTeam' | 'createdBy'>, users: readonly CrmUser[]): string[] => {
  const usersById = getUsersById(users);
  const memberIds = customer.careTeam.length > 0 ? customer.careTeam.map((member) => member.userId) : [customer.createdBy];
  return [...new Set(memberIds.flatMap((userId) => {
    const user = usersById.get(userId);
    return user ? teamIdsOfUser(user as CrmUser & { teamIds?: string[] }) : [];
  }))];
};

/**
 * Phạm vi xem (QT6): Quản trị xem tất cả; Quản lý xem khách của nhóm mình quản lý hoặc mình trong nhóm chăm sóc;
 * Nhân viên chỉ xem khách có mình trong nhóm chăm sóc. [Prototype] Khách đã xóa mềm KHÔNG thuộc phạm vi xem thường
 * (chỉ màn "Khách đã xóa" của Quản trị đọc), giống backend (`deletedAt: null` trong mọi truy vấn khách).
 */
export const canAccessCustomer = (actor: CrmActor, customer: Pick<Customer, 'careTeam' | 'createdBy'> & { deletedAt?: string | null }, users: readonly CrmUser[]): boolean => {
  if (customer.deletedAt) return false;
  if (actor.role === 'ADMIN') return true;
  if (isInCareTeam(customer.careTeam, actor.userId)) return true;
  if (actor.role === 'MANAGER') {
    const teamIds = getCustomerTeamIds(customer, users);
    return teamIds.some((teamId) => actor.managedTeamIds.includes(teamId));
  }
  return false;
};

/** Lý do bị từ chối xóa: không đủ quyền (403 `INSUFFICIENT_ROLE`) hoặc khách chưa thuộc nhóm "Bỏ" (409 `CUSTOMER_NOT_DROPPED`). */
export type DeleteDenial = 'FORBIDDEN' | 'NOT_DROPPED';

interface DeleteContext {
  /** Khách đang thuộc nhóm danh sách "Bỏ". */
  isDropped: boolean;
  /** Xóa hàng loạt: MỌI vai trò chỉ được xóa khách "Bỏ"; xóa đơn: Quản trị/Quản lý không đòi tình trạng, Nhân viên luôn đòi. */
  requireDropped: boolean;
}

/**
 * Quyền xóa mềm 1 khách (`customer-delete-policy.ts`) — DÙNG CHUNG cho xóa đơn, xóa hàng loạt và cờ `permissions.canDelete`:
 * Quản trị mọi khách; Quản lý chỉ khách có nhóm giao với nhóm mình quản lý; Nhân viên chỉ khi là phụ trách chính VÀ khách "Bỏ".
 */
export const getDeleteDenial = (
  actor: CrmActor,
  customer: Pick<Customer, 'careTeam' | 'createdBy'>,
  users: readonly CrmUser[],
  { isDropped, requireDropped }: DeleteContext,
): DeleteDenial | null => {
  const isOwner =
    actor.role === 'ADMIN' ||
    (actor.role === 'MANAGER' && getCustomerTeamIds(customer, users).some((teamId) => actor.managedTeamIds.includes(teamId))) ||
    (actor.role === 'STAFF' && getPrimaryUserId(customer.careTeam) === actor.userId);
  if (!isOwner) return 'FORBIDDEN';
  if ((requireDropped || actor.role === 'STAFF') && !isDropped) return 'NOT_DROPPED';
  return null;
};

interface PermissionContext {
  users?: readonly CrmUser[];
  isDropped?: boolean;
}

/** Quyền thao tác trên 1 khách (ma trận 04 §4.2) — chỉ gọi khi đã `canAccessCustomer`. */
export const getCustomerPermissions = (actor: CrmActor, customer: Pick<Customer, 'careTeam'> & Partial<Pick<Customer, 'createdBy'>>, context: PermissionContext = {}): CustomerPermissions => {
  const isAdminOrManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const isPrimary = getPrimaryUserId(customer.careTeam) === actor.userId;
  return {
    canEdit: true,
    canManageCareTeam: isAdminOrManager || isPrimary,
    canChangePrimary: isAdminOrManager,
    // v1.0.5 (FR-11): đặt PRIMARY một lần khi nhóm chăm sóc rỗng (khách cũ không còn người phụ trách).
    canSetInitialPrimary: isAdminOrManager && customer.careTeam.length === 0,
    canDelete: getDeleteDenial(actor, { careTeam: customer.careTeam, createdBy: customer.createdBy ?? '' }, context.users ?? [], { isDropped: context.isDropped ?? false, requireDropped: false }) === null,
    canRevealNationalId: isAdminOrManager || isPrimary,
    canReviewJoinRequests: isAdminOrManager || isPrimary,
  };
};

/** Menu/màn theo vai trò (tài liệu 02 §3): Báo cáo cho Quản lý/Quản trị; Cài đặt + Dự án cho Quản trị. */
export const canViewReports = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
export const canViewSettings = (role: UserRole): boolean => role === 'ADMIN';
export const canViewProjectCatalog = (role: UserRole): boolean => role === 'ADMIN';
/** Màn "Khách đã xóa" (khôi phục, xóa vĩnh viễn — Sửa đổi D): chỉ Quản trị. */
export const canViewDeletedCustomers = (role: UserRole): boolean => role === 'ADMIN';
/** Thêm/sửa/xoá dự án (04 §4.2, X7): chỉ Quản trị. */
export const canManageProjects = (role: UserRole): boolean => role === 'ADMIN';
/** Xuất danh sách (X8, 04 §4.2): Quản trị, Quản lý. */
export const canExportCustomers = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
/** Nhập dữ liệu (X8): chỉ Quản trị. */
export const canImportCustomers = (role: UserRole): boolean => role === 'ADMIN';
/** Phân người chăm sóc hàng loạt: Quản trị, Quản lý. */
export const canBulkAssign = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
