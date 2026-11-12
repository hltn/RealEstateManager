import { Types } from 'mongoose';
import { CareRole } from '../customers/customer.constants';
import { toMemberUser } from '../customers/customer.mapper';
import type { RefMaps } from '../customers/customer-refs.service';
import { toUserRef } from '../customers/customer-refs.service';
import { CareTeamEntry } from '../customers/schemas/customer.schema';
import { CareTeamResponseDto } from './dtos/care-team.dto';
import { findPrimary } from './care-team.rules';

/** Mọi `userId` cần dịch tên để dựng `CareTeamResponse` (thành viên + người thêm). */
export const careTeamUserIds = (careTeam: CareTeamEntry[]): Types.ObjectId[] =>
  careTeam.flatMap((member) =>
    member.addedBy ? [member.userId, member.addedBy] : [member.userId],
  );

export const toCareTeamResponse = (
  careTeam: CareTeamEntry[],
  maps: Pick<RefMaps, 'users' | 'userStates'>,
): CareTeamResponseDto => {
  const { users, userStates } = maps;
  const primary = findPrimary(careTeam);
  return {
    members: careTeam.map((member) => ({
      user: toMemberUser(member.userId, maps),
      role: member.role,
      addedAt: new Date(member.addedAt).toISOString(),
      addedBy: toUserRef(member.addedBy, users),
    })),
    primary: primary ? toUserRef(primary.userId, users, userStates) : null,
  };
};

/** Nhãn dễ đọc của nhóm cho audit: `Tên (PRIMARY|MEMBER)`. */
export const careTeamLabels = (
  careTeam: CareTeamEntry[],
  users: Map<string, string>,
): string[] =>
  careTeam.map(
    (member) =>
      `${users.get(String(member.userId)) ?? String(member.userId)} (${
        member.role === CareRole.PRIMARY ? 'PRIMARY' : 'MEMBER'
      })`,
  );
