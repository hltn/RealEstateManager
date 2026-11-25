import { dropUniquePhone } from '../drop-unique-phone';
import type { Migration } from '../migration.types';

/**
 * Migration 011 (FR-01, FR-06, FR-21), pha `post-up`, đánh số CUỐI: chỉ chạy sau khi backend mới đã sống.
 * MỘT CHIỀU: không có `down`; khi đã có SĐT trùng/null thì không dựng lại unique được. Cần `mongodump` trước (deploy
 * bước 5). Logic ở `drop-unique-phone.ts`; file này nối vào runner.
 */
export const migration011CrmDropUniquePhone: Migration = {
  id: '011_crm_drop_unique_phone',
  description:
    'MỘT CHIỀU (post-up): gỡ index unique customers.phone_1, tạo phone_1 thường, chuyển phone "anonymized:..." về null; không có down',
  phase: 'post-up',
  up: async ({ db, log }) => {
    await dropUniquePhone(db, log);
  },
};
