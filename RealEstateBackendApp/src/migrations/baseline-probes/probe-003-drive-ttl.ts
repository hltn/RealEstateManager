import type { Db } from 'mongodb';
import { listIndexesIfExists } from './mongo-read.util';
import type { BaselineProbe, ProbeResult } from './probe.types';

export const PROBE_003_ID = '003_drop_googledrivetokens_ttl_index';

const COLLECTION = 'googledrivetokens';

/**
 * Probe 003: `googledrivetokens` không còn index TTL khóa `expiresAt` (index khóa `expiresAt` kèm
 * `expireAfterSeconds`). Collection chưa tồn tại = đạt.
 */
export const probe003DriveTtl: BaselineProbe = {
  id: PROBE_003_ID,
  run: async (db: Db): Promise<ProbeResult> => {
    const indexes = await listIndexesIfExists(db, COLLECTION);
    const ttlIndexes = indexes.filter(
      (index) =>
        typeof index.expireAfterSeconds === 'number' &&
        typeof index.key === 'object' &&
        index.key !== null &&
        'expiresAt' in (index.key as Record<string, unknown>),
    );
    return {
      id: PROBE_003_ID,
      passed: ttlIndexes.length === 0,
      counts: { ttlIndexes: ttlIndexes.length },
      warnings: [],
    };
  },
};
