import type { UserDocument } from './schemas/user.schema';
import type { UserRole } from '../../common/enums/user-role.enum';
import type { UserStatus } from '../../common/enums/user-status.enum';

/** Shape trả về API (KHÔNG chứa password). `teamId` là field mới, `null` = chưa thuộc nhóm. */
export interface UserPublicProfile {
  _id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  teamId: string | null;
}

/** Map document -> shape công khai; chỉ chọn field cho phép (Least Privilege Data). */
export function toUserPublicProfile(doc: UserDocument): UserPublicProfile {
  return {
    _id: String(doc._id),
    email: doc.email,
    displayName: doc.displayName,
    role: doc.role,
    status: doc.status,
    teamId: doc.teamId ? String(doc.teamId) : null,
  };
}
