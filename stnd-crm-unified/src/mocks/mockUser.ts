import { SEED_TEAMS, SEED_USERS, DEFAULT_CURRENT_USER_ID } from '@crm/data/seedCatalogs';
import type { AdminUser, Team } from '@crm/types/crm';
import type { AuthUser, UserRole } from '../types/user';
import { highestRole } from '../utils/userRoles';

/**
 * [Prototype] Tài khoản mẫu: NGUỒN DUY NHẤT là `SEED_USERS` của store CRM (xem `modules/crm/data/seedCatalogs.ts`) — cả `/auth/*`, `/users`
 * lẫn bộ lọc/phân quyền CRM đều đọc cùng dữ liệu, nên đổi vai trò/nhóm ở Cài đặt hoặc "Quản lý tài khoản" có hiệu lực ở mọi nơi.
 */

/**
 * Hồ sơ phiên đăng nhập (`AuthUser`) của 1 tài khoản mẫu, dựng theo response `GET /auth/me`: `role` = role cao nhất (chỉ có EDITOR thì EDITOR),
 * `roles` đầy đủ, `teamId` = nhóm chính, `managedTeamIds` = nhóm người này là Quản lý.
 */
export const toAuthUser = (user: AdminUser, teams: readonly Team[]): AuthUser => ({
  _id: user.id,
  email: user.email ?? '',
  displayName: user.displayName,
  role: (highestRole(user.roles) ?? 'STAFF') as UserRole,
  roles: user.roles as UserRole[],
  status: user.isActive ? 'ACTIVE' : 'BLOCKED',
  teamId: user.teamIds[0] ?? null,
  managedTeamIds: user.roles.includes('MANAGER') ? teams.filter((team) => team.managerIds.includes(user.id)).map((team) => team.id) : [],
});

/** Tài khoản đăng nhập sẵn khi mở prototype (Quản trị) — dùng cho seed `main.tsx`. */
export const MOCK_USER: AuthUser = toAuthUser(SEED_USERS.find((user) => user.id === DEFAULT_CURRENT_USER_ID) as AdminUser, SEED_TEAMS);

export const MOCK_ACCESS_TOKEN = 'mock-access-token';
