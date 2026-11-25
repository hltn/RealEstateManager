import { migrateCatalogCodes } from '../../modules/crm/catalogs/migrations/migrate-catalog-codes';
import type { Migration } from '../migration.types';

/**
 * Migration 007 (FR-40): điền mã bất biến `…Code` cho dữ liệu CRM cũ (ghi kép cùng id) và tạo chỉ mục mới.
 * Logic nằm ở `migrate-catalog-codes.ts` (kiểm thử tích hợp ở đó); file này chỉ nối vào runner.
 * Bản ghi mồ côi làm migration ném lỗi nên KHÔNG ghi sổ `system`; phần còn lại đã được điền sẵn.
 */
export const migration007CrmCatalogCodes: Migration = {
  id: '007_crm_catalog_codes',
  description:
    'Điền mã bất biến (areas.code, statusCode, sourceCode, areaCode, interestedProjectCodes, contactResultCode, projectCode) và chỉ mục mới',
  up: async ({ db, log }) => {
    await migrateCatalogCodes(db, true, log);
  },
};
