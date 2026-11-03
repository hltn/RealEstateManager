import type { Db } from 'mongodb';
import { migrateAreasTo34Provinces } from '../../modules/crm/catalogs/migrations/migrate-areas-to-34-provinces';
import type { BaselineProbe, ProbeResult } from './probe.types';

export const PROBE_006_ID = '006_areas_34_provinces';

/**
 * Probe 006: dry-run `migrateAreasTo34Provinces` báo 0 việc (không khách/dự án trỏ khu vực cũ, không khu vực thừa
 * cần xóa, đủ 34 tỉnh, không tỉnh cần chuẩn hóa). Dry-run chỉ đếm, không ghi.
 */
export const probe006Areas: BaselineProbe = {
  id: PROBE_006_ID,
  run: async (db: Db): Promise<ProbeResult> => {
    const result = await migrateAreasTo34Provinces(db, false);
    const pendingWork =
      result.customersCleared +
      result.projectsCleared +
      result.areasDeleted +
      result.provincesInserted +
      result.provincesNormalized;
    return {
      id: PROBE_006_ID,
      passed: pendingWork === 0,
      counts: {
        customersCleared: result.customersCleared,
        projectsCleared: result.projectsCleared,
        areasDeleted: result.areasDeleted,
        provincesInserted: result.provincesInserted,
        provincesNormalized: result.provincesNormalized,
        provincesKept: result.provincesKept,
      },
      warnings: [],
    };
  },
};
