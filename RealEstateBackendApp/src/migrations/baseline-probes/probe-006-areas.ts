import type { Db } from 'mongodb';
import { migrateAreasTo34Provinces } from '../../modules/crm/catalogs/migrations/migrate-areas-to-34-provinces';
import type { BaselineProbe, ProbeResult } from './probe.types';

export const PROBE_006_ID = '006_areas_34_provinces';

/**
 * Probe 006: dry-run `migrateAreasTo34Provinces` báo 0 việc (không khách/dự án trỏ khu vực cũ, không khu vực thừa
 * cần xóa, đủ 34 tỉnh, không tỉnh cần chuẩn hóa). Dry-run chỉ đếm, không ghi.
 *
 * Ngoại lệ: `areas` RỖNG HOÀN TOÀN (cài mới, CRM chưa bật nên chưa seed) thì "thiếu 34 tỉnh" KHÔNG tính là việc còn
 * lại: không có khu vực cũ nào để xóa/chuẩn hóa, 34 tỉnh do `CrmSeedService` tạo khi bật CRM. Khách/dự án còn trỏ
 * `areaId` mồ côi vẫn là việc còn lại. Mọi trường hợp "thiếu một phần" (có vài tỉnh nhưng thiếu tỉnh khác, còn khu
 * vực cũ, tỉnh lệch chuẩn) vẫn KHÔNG ĐẠT.
 */
export const probe006Areas: BaselineProbe = {
  id: PROBE_006_ID,
  run: async (db: Db): Promise<ProbeResult> => {
    const result = await migrateAreasTo34Provinces(db, false);
    // provincesKept === 0 kéo theo provincesNormalized === 0 (chỉ tỉnh giữ lại mới cần chuẩn hóa).
    const areasEmpty = result.provincesKept === 0 && result.areasDeleted === 0;
    const pendingWork =
      result.customersCleared +
      result.projectsCleared +
      result.areasDeleted +
      (areasEmpty ? 0 : result.provincesInserted) +
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
        // 1 = areas rỗng hoàn toàn (không tính thiếu 34 tỉnh là việc còn lại); tự giải thích provincesInserted=34 mà vẫn đạt.
        areasEmpty: areasEmpty ? 1 : 0,
      },
      warnings: [],
    };
  },
};
