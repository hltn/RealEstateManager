import { migrateProjectPropertyTypeCodes } from '../../modules/crm/catalogs/migrations/migrate-project-property-type-codes';
import type { Migration } from '../migration.types';

/**
 * Migration 008 (FR-46): ánh xạ chữ loại hình cũ của dự án sang `value` của trường chân dung `property_type`
 * (ghi `propertyTypeCodes`, chữ không khớp vào `unmappedPropertyTypes`, giữ nguyên `propertyTypes`).
 * Logic nằm ở `migrate-project-property-type-codes.ts` (kiểm thử tích hợp ở đó); file này chỉ nối vào runner.
 * Thiếu trường `property_type` thì ném lỗi nên KHÔNG ghi sổ `system`; seed chân dung rồi chạy lại.
 */
export const migration008CrmProjectPropertyTypeCodes: Migration = {
  id: '008_crm_project_property_type_codes',
  description:
    'Ánh xạ chữ loại hình cũ của dự án sang mã property_type (propertyTypeCodes, unmappedPropertyTypes)',
  up: async ({ db, log }) => {
    await migrateProjectPropertyTypeCodes(db, true, log);
  },
};
