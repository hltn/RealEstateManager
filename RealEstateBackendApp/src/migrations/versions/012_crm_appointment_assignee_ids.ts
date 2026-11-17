import { backfillAppointmentAssigneeIds } from '../backfill-appointment-assignee-ids';
import type { Migration } from '../migration.types';

/**
 * Migration 012 (FR-30), pha `post-up` (KHÔNG `pre-up`: 011 là `post-up` còn chờ, `findPhaseOrderViolation` sẽ từ chối
 * chạy 012 `pre-up` ở bước 6b). Chạy ở bước 90 của deploy, SAU 011 (`selectPendingMigrations` sắp theo id).
 * KHÔNG MỘT CHIỀU, chỉ cộng thêm: điền `appointments.assigneeIds` và tạo index `{ assigneeIds, startAt }`; giữ nguyên
 * `assigneeId` cũ. Idempotent, chạy lại an toàn. Logic ở `backfill-appointment-assignee-ids.ts`.
 */
export const migration012CrmAppointmentAssigneeIds: Migration = {
  id: '012_crm_appointment_assignee_ids',
  description:
    'post-up, KHÔNG một chiều (chỉ cộng thêm, chạy lại an toàn): điền appointments.assigneeIds từ assigneeId, tạo index { assigneeIds, startAt }; giữ assigneeId cũ đến v1.0.7',
  phase: 'post-up',
  up: async ({ db, log }) => {
    await backfillAppointmentAssigneeIds(db, log);
  },
};
