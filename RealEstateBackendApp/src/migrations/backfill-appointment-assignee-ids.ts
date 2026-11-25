import { isDeepStrictEqual } from 'util';
import type { AnyBulkWriteOperation, Db, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import { listCollectionIndexes } from './mongo-index.util';

const APPOINTMENTS = 'appointments';
const ASSIGNEE_IDS_INDEX_KEY = { assigneeIds: 1, startAt: 1 } as const;
const ASSIGNEE_IDS_INDEX_NAME = 'assigneeIds_1_startAt_1';
const BATCH_SIZE = 500;

/** Lịch chưa có `assigneeIds` (thiếu field hoặc null): cùng nghĩa với `getAssigneeIds` ở BE (`assigneeIds ?? [assigneeId]`). */
const MISSING_ASSIGNEE_IDS = {
  $or: [{ assigneeIds: { $exists: false } }, { assigneeIds: null }],
};

export interface BackfillAssigneeIdsStats {
  /** Số lịch vừa được điền `assigneeIds` ở lần chạy này (chạy lại = 0). */
  backfilled: number;
  /** Số lịch bị bỏ qua vì `assigneeId` không phải ObjectId hợp lệ (cần xử lý tay; chạy lại vẫn bị bỏ qua). */
  skipped: number;
}

export interface BackfillAppointmentAssigneeIdsResult extends BackfillAssigneeIdsStats {
  /** `true` nếu lần này vừa tạo index `{ assigneeIds: 1, startAt: 1 }`; `false` nếu đã có. */
  indexCreated: boolean;
}

/** Chuỗi hex 24 ký tự (dạng ObjectId hợp lệ) mới ép kiểu được; `ObjectId.isValid` quá rộng (nhận cả chuỗi 12 ký tự). */
const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * `assigneeId` cũ -> `assigneeIds`: thiếu/null thì `[]` (rỗng thật); ObjectId thì `[id]`; chuỗi 24 hex thì ép kiểu rồi
 * `[id]`. Giá trị khác (chuỗi hỏng, số, object lạ) trả `null` = KHÔNG suy được người thực hiện: nơi gọi bỏ qua bản ghi
 * (không ghi `[]`, vì `[]` sẽ làm mất người thực hiện mà `assigneeId` còn đang giữ).
 */
const toIds = (assigneeId: unknown): ObjectId[] | null => {
  if (assigneeId === undefined || assigneeId === null) return [];
  if (assigneeId instanceof ObjectId) return [assigneeId];
  if (typeof assigneeId === 'string' && OBJECT_ID_HEX.test(assigneeId)) {
    return [new ObjectId(assigneeId)];
  }
  return null;
};

/**
 * (1) Điền `assigneeIds` cho lịch chưa có: `[assigneeId]` nếu có người thực hiện cũ, ngược lại `[]`. Mỗi bản ghi được
 * ghi bằng bộ lọc có kèm điều kiện "vẫn chưa có `assigneeIds`", nên lịch mà BE mới vừa ghi chen giữa (đã ghi kép) KHÔNG
 * bị ghi đè và chạy lại không đổi gì (idempotent). Không đụng `assigneeId` (field cũ giữ đến v1.0.7).
 * `assigneeId` không phải ObjectId: chuỗi 24 hex thì ép kiểu; không hợp lệ thì BỎ QUA bản ghi (đếm vào `skipped`, log
 * cảnh báo kèm `_id` để xử lý tay), không biến thành `[]` làm mất dữ liệu. Vì bản ghi bị bỏ qua vẫn "thiếu
 * `assigneeIds`", đọc theo lô phân trang theo `_id` (không đọc lại từ đầu) để chúng không chặn các lô sau.
 */
export async function backfillAssigneeIds(
  db: Db,
  log?: (message: string) => void,
): Promise<BackfillAssigneeIdsStats> {
  const appointments = db.collection(APPOINTMENTS);
  const stats: BackfillAssigneeIdsStats = { backfilled: 0, skipped: 0 };
  let lastId: ObjectId | undefined;
  for (;;) {
    const batch = (await appointments
      .find(
        lastId
          ? { _id: { $gt: lastId }, ...MISSING_ASSIGNEE_IDS }
          : MISSING_ASSIGNEE_IDS,
        {
          projection: { assigneeId: 1 },
        },
      )
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray()) as Document[];
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]._id as ObjectId;
    const writes: AnyBulkWriteOperation<Document>[] = [];
    for (const doc of batch) {
      const ids = toIds(doc.assigneeId);
      if (ids === null) {
        stats.skipped += 1;
        log?.(
          `CẢNH BÁO appointments ${String(doc._id)}: assigneeId không phải ObjectId hợp lệ (${String(doc.assigneeId)}), bỏ qua, cần xử lý tay`,
        );
        continue;
      }
      writes.push({
        updateOne: {
          filter: { _id: doc._id, ...MISSING_ASSIGNEE_IDS },
          update: { $set: { assigneeIds: ids } },
        },
      });
    }
    if (writes.length > 0) {
      const result = await appointments.bulkWrite(writes, { ordered: false });
      stats.backfilled += result.modifiedCount;
    }
  }
  return stats;
}

const sameKey = (existing: Document): boolean =>
  isDeepStrictEqual(
    Object.entries((existing.key as Document | undefined) ?? {}),
    Object.entries(ASSIGNEE_IDS_INDEX_KEY),
  );

/** (2) Tạo index đa khóa `{ assigneeIds: 1, startAt: 1 }` nếu chưa có index cùng khóa (không đụng index cũ `{ assigneeId, startAt }`). */
export async function ensureAssigneeIdsIndex(db: Db): Promise<boolean> {
  const existing = await listCollectionIndexes(db, APPOINTMENTS);
  if (existing.some(sameKey)) return false;
  await db
    .collection(APPOINTMENTS)
    .createIndex(
      { ...ASSIGNEE_IDS_INDEX_KEY },
      { name: ASSIGNEE_IDS_INDEX_NAME },
    );
  return true;
}

/**
 * Migration 012 `up` (post-up, FR-30; Architecture 5.13.2 hàng 12): THÊM, không xóa gì (không MỘT CHIỀU). Backfill
 * `assigneeIds` rồi tạo index đa khóa; cả hai bước đều idempotent nên chạy lại an toàn (kể cả sau khi lùi BE). Field cũ
 * `assigneeId` và index cũ giữ nguyên (ghi kép) đến v1.0.7, khi phải backfill lại lần cuối trước khi bỏ chúng.
 */
export async function backfillAppointmentAssigneeIds(
  db: Db,
  log?: (message: string) => void,
): Promise<BackfillAppointmentAssigneeIdsResult> {
  const { backfilled, skipped } = await backfillAssigneeIds(db, log);
  const isIndexCreated = await ensureAssigneeIdsIndex(db);
  log?.(
    `appointments: điền assigneeIds cho ${backfilled} lịch` +
      `${skipped > 0 ? ` (bỏ qua ${skipped} lịch có assigneeId hỏng)` : ''}; ` +
      `${isIndexCreated ? 'đã tạo' : 'đã có'} index ${ASSIGNEE_IDS_INDEX_NAME}`,
  );
  return { backfilled, skipped, indexCreated: isIndexCreated };
}
