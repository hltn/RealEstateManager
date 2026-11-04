import type { Db } from 'mongodb';
import { probe002UrlHash } from './probe-002-urlhash';
import { probe003DriveTtl } from './probe-003-drive-ttl';
import { probe004UserTeamId } from './probe-004-user-team-id';
import { probe005UserRoles } from './probe-005-user-roles';
import { probe006Areas } from './probe-006-areas';
import type { BaselineProbe, ProbeResult } from './probe.types';

export type { BaselineProbe, ProbeResult } from './probe.types';

/** Danh sách probe theo thứ tự id (khớp `BASELINE_MIGRATION_IDS`: 002..006). */
export const BASELINE_PROBES: readonly BaselineProbe[] = [
  probe002UrlHash,
  probe003DriveTtl,
  probe004UserTeamId,
  probe005UserRoles,
  probe006Areas,
];

/** Chạy tuần tự các probe cho `ids` (chỉ đọc). Id không có probe thì ném lỗi (lỗi lập trình, không âm thầm bỏ qua). */
export const runBaselineProbes = async (
  db: Db,
  ids: readonly string[],
): Promise<ProbeResult[]> => {
  const results: ProbeResult[] = [];
  for (const id of ids) {
    const probe = BASELINE_PROBES.find((candidate) => candidate.id === id);
    if (!probe) throw new Error(`Không có probe baseline cho ${id}`);
    results.push(await probe.run(db));
  }
  return results;
};
