import { FIRST_REGISTRY_MIGRATION_NUMBER } from './system.constants';
import type { Migration } from './migration.types';
import { migration007CrmCatalogCodes } from './versions/007_crm_catalog_codes';
import { migration008CrmProjectPropertyTypeCodes } from './versions/008_crm_project_property_type_codes';
import { migration009NotificationAttachmentIndexes } from './versions/009_notification_attachment_indexes';

/**
 * Registry migration khai báo TƯỜNG MINH. CHỈ chứa từ 007 trở đi: 002..006 đã chạy tay trên production (có bước xóa),
 * không bọc adapter, không tự chạy lại (xem lệnh `baseline`). Thêm migration mới bằng cách import và nối vào mảng
 * này theo thứ tự số.
 */
export const MIGRATIONS: readonly Migration[] = [
  migration007CrmCatalogCodes,
  migration008CrmProjectPropertyTypeCodes,
  migration009NotificationAttachmentIndexes,
];

const MIGRATION_ID_PATTERN = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Tách số thứ tự từ id `NNN_ten`; `null` nếu sai định dạng. */
export const parseMigrationNumber = (id: string): number | null => {
  const match = MIGRATION_ID_PATTERN.exec(id);
  return match ? Number(match[1]) : null;
};

/**
 * Kiểm tra registry: id đúng định dạng, không trùng số/id, bắt đầu từ 007, liên tiếp không hở số, đã sắp tăng dần.
 * Trả về danh sách lỗi (rỗng = hợp lệ) để vừa dùng ở unit test vừa chặn runner chạy trên registry hỏng.
 */
export const validateMigrationRegistry = (
  migrations: readonly Migration[],
): string[] => {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenNumbers = new Set<number>();
  let previous = FIRST_REGISTRY_MIGRATION_NUMBER - 1;

  for (const migration of migrations) {
    const number = parseMigrationNumber(migration.id);
    if (number === null) {
      errors.push(`id "${migration.id}" sai định dạng NNN_ten (chữ thường)`);
      continue;
    }
    if (seenIds.has(migration.id) || seenNumbers.has(number)) {
      errors.push(`trùng id/số thứ tự: ${migration.id}`);
      continue;
    }
    seenIds.add(migration.id);
    seenNumbers.add(number);
    if (number < FIRST_REGISTRY_MIGRATION_NUMBER) {
      errors.push(
        `${migration.id}: registry chỉ chứa từ ${String(FIRST_REGISTRY_MIGRATION_NUMBER).padStart(3, '0')} trở đi`,
      );
    } else if (number !== previous + 1) {
      errors.push(
        `${migration.id}: số thứ tự phải liên tiếp (mong đợi ${String(previous + 1).padStart(3, '0')})`,
      );
    }
    previous = number;
  }
  return errors;
};
