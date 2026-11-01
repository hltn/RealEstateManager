import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';

/**
 * Người thực hiện request CRM, đọc từ DB (KHÔNG nhét team vào JWT để đổi nhóm có hiệu lực ngay —
 * tài liệu 04 mục 4.3). Role/nhóm ở đây là dữ liệu HIỆN TẠI trong DB.
 *
 * Một tài khoản có nhiều role/nhóm: `role` là role CAO NHẤT (ADMIN > MANAGER > STAFF > EDITOR) và là cơ sở của phạm vi
 * khách (MANAGER+STAFF → phạm vi MANAGER; ADMIN+bất kỳ → tất cả); `teamId` là nhóm chính (= `teamIds[0]`).
 */
export interface CrmActor {
  userId: Types.ObjectId;
  /** Role cao nhất. */
  role: UserRole;
  /** Mọi role của tài khoản (STAFF+EDITOR ngang quyền: cả hai cùng có hiệu lực). */
  roles: UserRole[];
  displayName: string;
  /** Nhóm chính (phần tử đầu của `teamIds`). */
  teamId: Types.ObjectId | null;
  /** Mọi nhóm của người này. */
  teamIds: Types.ObjectId[];
  /** Các nhóm (chưa xóa) mà người này là Quản lý; luôn rỗng nếu không có role MANAGER. */
  managedTeamIds: Types.ObjectId[];
}

/** Hai danh sách nhóm có ít nhất một nhóm chung (so theo giá trị ObjectId). */
export const sharesAnyTeam = (
  left: readonly Types.ObjectId[],
  right: readonly Types.ObjectId[],
): boolean => left.some((a) => right.some((b) => a.equals(b)));

/**
 * Tập nhóm mà actor được phân người vào chăm sóc khách khi bị giới hạn phạm vi (nguồn luật DUY NHẤT dùng chung cho
 * `assertAssignable` và danh sách `assignable-users`, để danh sách không liệt kê người mà thao tác phân sau đó sẽ bị từ chối):
 * - ADMIN: `null` = không giới hạn.
 * - MANAGER (role cao nhất): CHỈ các nhóm mình quản lý (không gồm nhóm mình chỉ là thành viên).
 * - STAFF: các nhóm mình thuộc về.
 * - Vai trò khác: rỗng.
 * Ngoài ra chính actor luôn được phân cho chính mình (`assertAssignable` cho qua riêng; danh sách không thêm mục này).
 */
export const resolveAssignableTeamIds = (
  actor: CrmActor,
): Types.ObjectId[] | null => {
  if (actor.role === UserRole.ADMIN) return null;
  if (actor.role === UserRole.MANAGER) return actor.managedTeamIds;
  if (actor.role === UserRole.STAFF) return actor.teamIds;
  return [];
};

/**
 * Tập nhóm mà actor được "nhìn thấy" (danh sách nhóm, người có thể phân chăm sóc).
 * - ADMIN: `null` = không giới hạn.
 * - MANAGER (role cao nhất): nhóm mình quản lý + mọi nhóm mình thuộc về.
 * - STAFF: chỉ các nhóm mình thuộc về (chưa có nhóm thì rỗng).
 * - Vai trò khác (EDITOR...): rỗng — không có quyền CRM.
 */
export const resolveVisibleTeamIds = (
  actor: CrmActor,
): Types.ObjectId[] | null => {
  if (actor.role === UserRole.ADMIN) return null;
  const ids: Types.ObjectId[] = [];
  if (actor.role === UserRole.MANAGER) ids.push(...actor.managedTeamIds);
  if (actor.role === UserRole.MANAGER || actor.role === UserRole.STAFF) {
    ids.push(...actor.teamIds);
  }
  const unique = new Map(ids.map((id) => [id.toHexString(), id]));
  return [...unique.values()];
};
