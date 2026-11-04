import { Types } from 'mongoose';
import type { UserDocument } from './schemas/user.schema';
import type { UserRole } from '../../common/enums/user-role.enum';
import type { UserStatus } from '../../common/enums/user-status.enum';
import { rolesOf } from '../../common/utils/user-roles.util';

/**
 * Shape trả về API (KHÔNG chứa password).
 * - `role`/`teamId`: role cao nhất / nhóm chính — giữ cho client cũ.
 * - `roles`/`teamIds`: danh sách đầy đủ (nhiều role, nhiều nhóm).
 */
export interface UserPublicProfile {
  _id: string;
  email: string;
  displayName: string;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  teamId: string | null;
  teamIds: string[];
}

type TeamRef = Types.ObjectId | string;

/** Nhóm của user: ưu tiên `teamIds[]`; bản ghi chưa migrate chỉ có `teamId` đơn thì coi như `[teamId]`. */
export const teamIdsOf = (doc: {
  teamId?: TeamRef | null;
  teamIds?: readonly TeamRef[] | null;
}): string[] => {
  if (doc.teamIds && doc.teamIds.length > 0) return doc.teamIds.map(String);
  return doc.teamId ? [String(doc.teamId)] : [];
};

/** Như `teamIdsOf` nhưng trả ObjectId (dùng khi dựng truy vấn/so sánh trong service). */
export const teamObjectIdsOf = (doc: {
  teamId?: TeamRef | null;
  teamIds?: readonly TeamRef[] | null;
}): Types.ObjectId[] => teamIdsOf(doc).map((id) => new Types.ObjectId(id));

/** Map document -> shape công khai; chỉ chọn field cho phép (Least Privilege Data). */
export function toUserPublicProfile(doc: UserDocument): UserPublicProfile {
  const teamIds = teamIdsOf(doc);
  return {
    _id: String(doc._id),
    email: doc.email,
    displayName: doc.displayName,
    role: doc.role,
    roles: rolesOf(doc) as UserRole[],
    status: doc.status,
    teamId: teamIds[0] ?? null,
    teamIds,
  };
}
