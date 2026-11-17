/**
 * Phân quyền theo vai trò + phạm vi khách (X1, QT6 — tài liệu 04 §4.1–4.3), mô phỏng `CustomerAccessService`.
 * Áp ở LỚP TRUY CẬP DỮ LIỆU (mọi truy vấn khách đi qua `canAccessCustomer`), không chỉ ẩn nút trên UI.
 * Khách ngoài phạm vi được coi như không tồn tại (backend trả 404 `CUSTOMER_NOT_FOUND`).
 *
 * [Prototype] Khác bản app chính: app chính lấy quyền từ backend (`permissions` trong response); prototype tự tính ở đây theo ĐÚNG luật
 * backend (`customer-scope.ts`, `customer-delete-policy.ts`, `customer-owner-team.ts`, `crm-actor.ts`): tài khoản nhiều role/nhóm, Quản lý theo
 * `managedTeamIds`, quyền chủ khách (xem CCCD, mời/gỡ) theo Quản trị / người tạo / Quản lý nhóm chủ (FR-31).
 */
import type { AssigneeSourceCustomer } from '@crm/lib/appointmentAssignees';
import { isInCareTeam } from '@crm/lib/customerRules';
import type { CrmUser, Customer, Team, UserRole } from '@crm/types/crm';
import type { CustomerPermissions, OwnerRef } from './types';

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
 * Phạm vi xem (QT6): Quản trị xem tất cả; Quản lý xem khách của nhóm mình quản lý, mình trong nhóm chăm sóc;
 * Nhân viên chỉ xem khách có mình trong nhóm chăm sóc; cả hai luôn thấy khách do mình tạo. [Prototype] Khách đã xóa mềm KHÔNG thuộc phạm vi xem thường
 * (chỉ màn "Khách đã xóa" của Quản trị đọc), giống backend (`deletedAt: null` trong mọi truy vấn khách).
 */
export const canAccessCustomer = (actor: CrmActor, customer: Pick<Customer, 'careTeam' | 'createdBy'> & { deletedAt?: string | null }, users: readonly CrmUser[]): boolean => {
  if (customer.deletedAt) return false;
  if (actor.role === 'ADMIN') return true;
  if (isInCareTeam(customer.careTeam, actor.userId)) return true;
  // FR-31 (khớp `buildCustomerScope` backend): người tạo luôn thấy khách của mình, kể cả khi không (còn) trong nhóm chăm sóc.
  if (customer.createdBy === actor.userId) return true;
  if (actor.role === 'MANAGER') {
    const teamIds = getCustomerTeamIds(customer, users);
    return teamIds.some((teamId) => actor.managedTeamIds.includes(teamId));
  }
  return false;
};

/**
 * Nhóm chủ của khách (FR-30/31, khớp backend `ownerTeamIdsOf`): nhóm của NGƯỜI TẠO (`createdBy`), cố định, không đổi khi đổi PRIMARY
 * hay thêm/gỡ thành viên. Người tạo không thuộc nhóm nào (vd Quản trị thuần) hoặc không còn trong danh sách tài khoản thì không có nhóm chủ.
 */
export const getOwnerTeamIds = (customer: Pick<Customer, 'createdBy'>, users: readonly CrmUser[]): string[] => {
  const creator = getUsersById(users).get(customer.createdBy);
  return creator ? teamIdsOfUser(creator as CrmUser & { teamIds?: string[] }) : [];
};

/**
 * Quyền CHỦ KHÁCH (FR-31): xem CCCD đầy đủ, mời/gỡ thành viên nhóm chăm sóc. Chỉ ba đối tượng, KHÔNG xét nhóm chăm sóc
 * (PRIMARY/MEMBER không tự có): Quản trị; người tạo khách (mọi vai trò); Quản lý của nhóm chủ (kể cả khi chưa trong nhóm chăm sóc).
 */
export const hasOwnerRights = (actor: CrmActor, customer: Pick<Customer, 'createdBy'>, users: readonly CrmUser[]): boolean =>
  actor.role === 'ADMIN' ||
  customer.createdBy === actor.userId ||
  (actor.managedTeamIds.length > 0 && getOwnerTeamIds(customer, users).some((teamId) => actor.managedTeamIds.includes(teamId)));

/** Lý do bị từ chối xóa: không đủ quyền (403 `INSUFFICIENT_ROLE`). Không còn lý do theo tình trạng khách (FR-31). */
export type DeleteDenial = 'FORBIDDEN';

/**
 * Quyền xóa mềm 1 khách (`customer-delete-policy.ts`) — DÙNG CHUNG cho xóa đơn, xóa hàng loạt và cờ `permissions.canDelete`:
 * CHỈ Quản trị hoặc người tạo khách (mọi vai trò), mọi tình trạng khách. Quản lý nhóm chủ, PRIMARY, MEMBER, Nhân viên khác: không.
 */
export const getDeleteDenial = (actor: CrmActor, customer: Pick<Customer, 'createdBy'>): DeleteDenial | null =>
  actor.role === 'ADMIN' || customer.createdBy === actor.userId ? null : 'FORBIDDEN';

/** Quyền thao tác trên 1 khách (ma trận 04 §4.2, luật v1.0.6) — chỉ gọi khi đã `canAccessCustomer`. */
export const getCustomerPermissions = (actor: CrmActor, customer: Pick<Customer, 'careTeam' | 'createdBy'>, users: readonly CrmUser[]): CustomerPermissions => {
  const hasOwnerRight = hasOwnerRights(actor, customer, users);
  return {
    canEdit: true,
    canManageCareTeam: hasOwnerRight,
    // v1.0.5 (FR-11): đặt PRIMARY một lần khi nhóm chăm sóc rỗng; việc đặt đi qua cổng mời nên phải có quyền chủ khách (FR-31).
    canSetInitialPrimary: hasOwnerRight && (actor.role === 'ADMIN' || actor.role === 'MANAGER') && customer.careTeam.length === 0,
    canDelete: getDeleteDenial(actor, customer) === null,
    canRevealNationalId: hasOwnerRight,
  };
};

/**
 * Nguồn dựng danh sách người thực hiện lịch hẹn (FR-30), CÙNG dạng với `CustomerDetail` mà màn hình nhận: nhóm chăm sóc +
 * Manager ACTIVE của nhóm chủ + người tạo khách ACTIVE có vai trò CRM; hai nhóm sau loại người đã ở nhóm chăm sóc (khớp backend).
 * Danh sách + mặc định + kiểm do `listAssignableAssignees` / `getDefaultAssigneeIds` (lib/appointmentAssignees, xuất lại ở đây) tính;
 * form và mock API cùng gọi đúng hai hàm đó trên nguồn này nên không thể lệch nhau.
 */
export const buildAssigneeSource = (customer: Pick<Customer, 'careTeam' | 'createdBy'>, users: readonly CrmUser[], teams: readonly Team[]): AssigneeSourceCustomer => {
  const usersById = getUsersById(users);
  const careTeamIds = new Set(customer.careTeam.map((member) => member.userId));
  const toRef = (user: CrmUser): OwnerRef => ({ userId: user.id, fullName: user.fullName, role: user.role });
  const isCrmUser = (user: CrmUser & { roles?: readonly string[] }) => user.isActive && (user.roles ?? [user.role]).some((role) => role === 'ADMIN' || role === 'MANAGER' || role === 'STAFF');
  const ownerTeamIds = new Set(getOwnerTeamIds(customer, users));
  const managerIds = [...new Set(teams.filter((team) => ownerTeamIds.has(team.id)).flatMap((team) => team.managerIds))];
  const ownerManagers = managerIds.flatMap((userId) => {
    const user = usersById.get(userId);
    const isManager = user && isCrmUser(user) && ((user as CrmUser & { roles?: readonly string[] }).roles ?? [user.role]).includes('MANAGER');
    return user && isManager && !careTeamIds.has(userId) ? [toRef(user)] : [];
  });
  const creator = usersById.get(customer.createdBy);
  const isCreatorListed = creator && isCrmUser(creator) && !careTeamIds.has(creator.id) && !ownerManagers.some((manager) => manager.userId === creator.id);
  return {
    careTeam: customer.careTeam.map((member) => {
      const user = usersById.get(member.userId);
      return {
        user: { id: member.userId, displayName: user?.displayName ?? 'Không rõ', fullName: user?.fullName ?? 'Không rõ', jobTitle: user?.jobTitle ?? '', isLocked: user ? !user.isActive : undefined },
        role: member.role,
        addedAt: member.addedAt,
        addedBy: { id: member.addedBy, displayName: usersById.get(member.addedBy)?.displayName ?? 'Không rõ' },
      };
    }),
    ownerManagers,
    creator: isCreatorListed ? toRef(creator) : null,
  };
};

export { getDefaultAssigneeIds, listAssignableAssignees, validateAssigneeIds } from '@crm/lib/appointmentAssignees';

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
/** Cột + bộ lọc "Người chăm sóc chính" của danh sách khách (FR-09): chỉ Quản trị, Quản lý; Nhân viên không thấy. */
export const canViewPrimaryAssignee = (role: UserRole): boolean => role === 'ADMIN' || role === 'MANAGER';
