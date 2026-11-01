/**
 * [Prototype] Xác định "người thao tác" (`CrmActor`) của lớp dữ liệu mock — hàm thuần, KHÔNG phụ thuộc React để cả hook (`hooks.ts`),
 * hàm ghi (`crmWriteApi.ts`) lẫn mock adapter (`mocks/handlers/users.ts`) dùng chung.
 * App chính lấy actor từ phiên đăng nhập thật; prototype lấy từ tài khoản mẫu đang đăng nhập (`auth.store`) + hồ sơ ở store CRM.
 */
import type { AdminUser, Team } from '@crm/types/crm';
import type { AuthUser } from '../../../types/user';
import { crmRoleOf } from '../../../utils/userRoles';
import { buildActor, type CrmActor } from './access';

/**
 * Hồ sơ vai trò/nhóm lấy từ store CRM (nguồn chung với `/users`: đổi vai trò/nhóm có hiệu lực ngay); không có trong store thì suy từ
 * chính phiên đăng nhập (`role`, `teamId`, `managedTeamIds`).
 */
export const resolveActor = (authUser: AuthUser | null, users: readonly AdminUser[], teams: readonly Team[]): CrmActor => {
  const stored = authUser ? users.find((user) => user.id === authUser._id) : undefined;
  if (stored) return buildActor(stored, teams);
  return {
    userId: authUser?._id ?? '',
    role: crmRoleOf(authUser),
    teamId: authUser?.teamId ?? null,
    teamIds: authUser?.teamId ? [authUser.teamId] : [],
    managedTeamIds: authUser?.managedTeamIds ?? [],
  };
};
