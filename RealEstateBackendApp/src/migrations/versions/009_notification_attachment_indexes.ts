import {
  createNotificationAttachmentIndexes,
  dropNotificationAttachmentIndexes,
} from '../notification-attachment-indexes';
import type { Migration } from '../migration.types';

/**
 * Migration 009 (FR-03, FR-26): CHỈ tạo index trên collection đã có dữ liệu (`notifications`, `crm_attachments`),
 * không sửa dữ liệu. Logic ở `notification-attachment-indexes.ts` (kiểm thử ở đó); file này nối vào runner.
 * `down` gỡ đúng hai index (đường lùi; runner hiện chưa gọi, chạy tay khi cần).
 */
export const migration009NotificationAttachmentIndexes: Migration = {
  id: '009_notification_attachment_indexes',
  description:
    'Tạo index notifications {pushStatus,createdAt} (partial PENDING) và crm_attachments {thumbStatus,createdAt} (partial NONE/FAILED)',
  up: async ({ db, log }) => {
    await createNotificationAttachmentIndexes(db, true, log);
  },
  down: async ({ db, log }) => {
    await dropNotificationAttachmentIndexes(db, log);
  },
};
