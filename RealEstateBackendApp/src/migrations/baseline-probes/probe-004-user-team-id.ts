import type { Db } from 'mongodb';
import { backfillUserTeamId } from '../../modules/users/migrations/backfill-user-team-id';
import { listIndexesIfExists } from './mongo-read.util';
import type { BaselineProbe, ProbeResult } from './probe.types';

export const PROBE_004_ID = '004_users_add_team_id';

/** Index `{ teamId: 1, status: 1 }` mà migration 004 tạo (chỉ cảnh báo nếu thiếu). */
const hasTeamStatusIndex = (indexKey: Record<string, unknown>): boolean => {
  const keys = Object.entries(indexKey);
  return (
    keys.length === 2 &&
    keys[0][0] === 'teamId' &&
    keys[0][1] === 1 &&
    keys[1][0] === 'status' &&
    keys[1][1] === 1
  );
};

/**
 * Probe 004: không còn user thiếu field `teamId` (dùng chính dry-run của migration: `missingBefore`). Index
 * `{ teamId, status }` KHÔNG là điều kiện (Mongoose autoIndex tự tạo khi backend khởi động), chỉ cảnh báo nếu thiếu.
 */
export const probe004UserTeamId: BaselineProbe = {
  id: PROBE_004_ID,
  run: async (db: Db): Promise<ProbeResult> => {
    const { missingBefore } = await backfillUserTeamId(db, false);
    const indexes = await listIndexesIfExists(db, 'users');
    const missingIndex =
      indexes.length > 0 &&
      !indexes.some((index) =>
        hasTeamStatusIndex(index.key as Record<string, unknown>),
      )
        ? 1
        : 0;
    return {
      id: PROBE_004_ID,
      passed: missingBefore === 0,
      counts: { missingTeamId: missingBefore, missingIndex },
      warnings: missingIndex
        ? [
            'users thiếu index {teamId,status} (Mongoose autoIndex sẽ tạo khi backend khởi động).',
          ]
        : [],
    };
  },
};
