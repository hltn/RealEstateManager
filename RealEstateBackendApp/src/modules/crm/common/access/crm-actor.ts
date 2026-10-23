import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';

/**
 * Người thực hiện request CRM, đọc từ DB (KHÔNG nhét team vào JWT để đổi nhóm có hiệu lực ngay —
 * tài liệu 04 mục 4.3). Role ở đây là role HIỆN TẠI trong DB.
 */
export interface CrmActor {
  userId: Types.ObjectId;
  role: UserRole;
  displayName: string;
  teamId: Types.ObjectId | null;
  /** Các nhóm (chưa xóa) mà người này là Quản lý; luôn rỗng nếu role không phải MANAGER. */
  managedTeamIds: Types.ObjectId[];
}

/**
 * Tập nhóm mà actor được "nhìn thấy" (danh sách nhóm, người có thể phân chăm sóc).
 * - ADMIN: `null` = không giới hạn.
 * - MANAGER: nhóm mình quản lý + nhóm mình thuộc về.
 * - STAFF: chỉ nhóm mình thuộc về (chưa có nhóm thì rỗng).
 * - Vai trò khác (EDITOR...): rỗng — không có quyền CRM.
 */
export const resolveVisibleTeamIds = (
  actor: CrmActor,
): Types.ObjectId[] | null => {
  if (actor.role === UserRole.ADMIN) return null;
  const ids: Types.ObjectId[] = [];
  if (actor.role === UserRole.MANAGER) ids.push(...actor.managedTeamIds);
  if (
    (actor.role === UserRole.MANAGER || actor.role === UserRole.STAFF) &&
    actor.teamId
  ) {
    ids.push(actor.teamId);
  }
  const unique = new Map(ids.map((id) => [id.toHexString(), id]));
  return [...unique.values()];
};
