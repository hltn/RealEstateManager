import type { Db } from 'mongodb';
import { backfillUserRolesTeamIds } from '../../modules/users/migrations/backfill-user-roles-team-ids';
import type { BaselineProbe, ProbeResult } from './probe.types';

export const PROBE_005_ID = '005_users_roles_teamids';

/**
 * Probe 005: không còn user chờ `roles[]`/`teamIds[]` (`pendingBefore` của dry-run, cùng định nghĩa
 * `USERS_PENDING_ROLES_TEAM_IDS_FILTER` với `UserRolesMigrationGuard`). `driftBefore` > 0 chỉ cảnh báo.
 */
export const probe005UserRoles: BaselineProbe = {
  id: PROBE_005_ID,
  run: async (db: Db): Promise<ProbeResult> => {
    const { pendingBefore, driftBefore } = await backfillUserRolesTeamIds(
      db,
      false,
    );
    return {
      id: PROBE_005_ID,
      passed: pendingBefore === 0,
      counts: { pendingUsers: pendingBefore, drift: driftBefore },
      warnings:
        driftBefore > 0
          ? [
              `${driftBefore} user có roles/teamIds lệch cặp role/teamId đơn (không chặn baseline).`,
            ]
          : [],
    };
  },
};
