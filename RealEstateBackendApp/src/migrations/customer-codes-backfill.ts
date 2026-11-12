import type { Db, Document, MongoClient, ObjectId } from 'mongodb';
import {
  COUNTER_KEY,
  formatCustomerCode,
  parseCustomerCodeSeq,
} from '../modules/crm/customers/customer-code.constants';
import { MIGRATION_DOC_PREFIX, SYSTEM_COLLECTION } from './system.constants';

const CUSTOMERS = 'customers';
const COUNTERS = 'counters';

/** Id doc sổ của migration 010: có doc này thì index partial + counter đã sẵn sàng, script mới được bù mã. */
export const CUSTOMER_CODES_GATE_ID = `${MIGRATION_DOC_PREFIX}010_crm_customer_code_index`;
/** Doc vết vận hành của script (`system`), KHÔNG nằm trong sổ migration (tiền tố `script:` khác `migration:`). */
export const CUSTOMER_CODES_SCRIPT_DOC_ID = 'script:crm-customer-codes';
/** Người ghi vết trong doc `script:crm-customer-codes`. */
export const CUSTOMER_CODES_SCRIPT_ACTOR = 'crm-customer-codes-cli';
/** Số khách mỗi lô (mỗi lô một transaction). */
export const CUSTOMER_CODES_DEFAULT_BATCH_SIZE = 500;

/** Khách chưa có mã: không có trường, `null` hay không phải chuỗi (khớp điều kiện của index partial). Gồm cả khách xóa mềm/ẩn danh. */
const MISSING_CODE_FILTER = {
  customerCode: { $not: { $type: 'string' } },
} as const;

export interface CustomerCodesBackfillOptions {
  /** `false` = dry-run: chỉ đếm, KHÔNG ghi gì (kể cả doc vết). */
  apply: boolean;
  /** Số khách mỗi lô; mặc định 500. */
  batchSize?: number;
  log: (line: string) => void;
  /** Gọi sau khi MỖI lô đã commit (dùng giám sát/test mô phỏng sự cố giữa chừng). Ném lỗi ở đây = dừng chạy. */
  afterBatch?: (info: {
    batch: number;
    assigned: number;
  }) => void | Promise<void>;
}

export interface CustomerCodesBackfillResult {
  /** `false` khi sổ chưa có migration 010: script thoát sớm, không đụng dữ liệu. */
  gateOpen: boolean;
  /** Số khách thiếu mã lúc bắt đầu (kể cả xóa mềm). */
  missingBefore: number;
  /** Trong đó khách đã xóa mềm. */
  missingSoftDeleted: number;
  /** Số khách vừa được cấp mã ở lần chạy này (dry-run luôn 0). */
  assigned: number;
  /** Số khách còn thiếu mã sau cùng (phải 0 sau `--apply` thành công). */
  remaining: number;
  /** Số mã bị trùng giữa các khách (phải 0). */
  duplicateCodes: number;
  batches: number;
}

const emptyResult = (
  gateOpen: boolean,
  patch: Partial<CustomerCodesBackfillResult> = {},
): CustomerCodesBackfillResult => ({
  gateOpen,
  missingBefore: 0,
  missingSoftDeleted: 0,
  assigned: 0,
  remaining: 0,
  duplicateCodes: 0,
  batches: 0,
  ...patch,
});

/** Lỗi khi một lô không cập nhật đủ khách (điều kiện `customerCode` thiếu không còn đúng): transaction đã rollback. */
export class CustomerCodesBatchMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `Lô bù mã cập nhật ${actual}/${expected} khách (có khách vừa được cấp mã bởi tiến trình khác); ` +
        'lô đã rollback, KHÔNG thủng số. Chạy lại lệnh để nối tiếp.',
    );
    this.name = 'CustomerCodesBatchMismatchError';
  }
}

const countMissing = (db: Db, extra: Document = {}): Promise<number> =>
  db.collection(CUSTOMERS).countDocuments({ ...MISSING_CODE_FILTER, ...extra });

/** Số thứ tự lớn nhất trong các mã đang có (0 nếu chưa có mã nào); mã sai định dạng bị bỏ qua. */
async function findMaxAssignedSeq(db: Db): Promise<number> {
  const cursor = db
    .collection(CUSTOMERS)
    .find(
      { customerCode: { $type: 'string' } },
      { projection: { customerCode: 1 } },
    );
  let max = 0;
  for await (const doc of cursor) {
    const seq = parseCustomerCodeSeq(doc.customerCode);
    if (seq !== null && seq > max) max = seq;
  }
  return max;
}

/**
 * Đồng bộ counter với mã lớn nhất đang có bằng `$max` (chỉ tăng, KHÔNG bao giờ lùi counter đã cao).
 * Chạy TRƯỚC khi cấp (counter lệch thấp sau khi khôi phục dump sẽ làm lô đầu đụng mã đã có) và SAU CÙNG (phòng thủ).
 */
async function syncCounterWithMaxCode(db: Db): Promise<void> {
  const maxSeq = await findMaxAssignedSeq(db);
  if (maxSeq < 1) return;
  await db
    .collection<{ _id: string; seq: number }>(COUNTERS)
    .updateOne(
      { _id: COUNTER_KEY },
      { $max: { seq: maxSeq } },
      { upsert: true },
    );
}

/** Số mã xuất hiện ở hơn một khách (index unique đáng lẽ chặn; kiểm lại phòng khi index bị gỡ). */
async function countDuplicateCodes(db: Db): Promise<number> {
  const rows = await db
    .collection(CUSTOMERS)
    .aggregate([
      { $match: { customerCode: { $type: 'string' } } },
      { $group: { _id: '$customerCode', total: { $sum: 1 } } },
      { $match: { total: { $gt: 1 } } },
      { $count: 'duplicates' },
    ])
    .toArray();
  return (rows[0]?.duplicates as number | undefined) ?? 0;
}

/**
 * Cấp mã cho MỘT lô khách trong MỘT transaction: `$inc` counter `k` (k = số khách trong lô) rồi `bulkWrite` đặt mã
 * `seq-k+1 … seq` theo đúng thứ tự lô; mỗi thao tác có điều kiện "vẫn chưa có mã". Lô không cập nhật đủ thì ném lỗi
 * để transaction rollback cả `$inc` (không thủng số, không tái sử dụng). Callback `withTransaction` có thể bị driver
 * chạy lại khi lỗi tạm thời, nên chỉ chứa thao tác lặp lại an toàn.
 */
async function assignBatch(
  client: MongoClient,
  db: Db,
  batchIds: readonly ObjectId[],
): Promise<void> {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const counter = await db
        .collection<{ _id: string; seq: number }>(COUNTERS)
        .findOneAndUpdate(
          { _id: COUNTER_KEY },
          { $inc: { seq: batchIds.length } },
          { upsert: true, returnDocument: 'after', session },
        );
      if (!counter) throw new Error(`Không cấp được bộ đếm ${COUNTER_KEY}`);
      const first = counter.seq - batchIds.length + 1;
      const result = await db.collection(CUSTOMERS).bulkWrite(
        batchIds.map((_id, index) => ({
          updateOne: {
            filter: { _id, ...MISSING_CODE_FILTER },
            update: {
              $set: { customerCode: formatCustomerCode(first + index) },
            },
          },
        })),
        { session, ordered: true },
      );
      if (result.modifiedCount !== batchIds.length) {
        throw new CustomerCodesBatchMismatchError(
          batchIds.length,
          result.modifiedCount,
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Bù mã khách cho dữ liệu cũ (FR-08, FR-21). Luồng:
 *  1. Cổng sổ: không có doc `migration:010_crm_customer_code_index` thì thoát sớm, không đụng dữ liệu (kiểm theo SỔ,
 *     không theo "lần chạy này", nên deploy chạy lại sau khi `up` lỗi vẫn bù được khách tạo trong khoảng trống).
 *  2. Dry-run: chỉ đếm khách thiếu mã (gồm xóa mềm/ẩn danh), không ghi.
 *  3. Apply: đồng bộ counter với mã đang có; lặp lô (mặc định 500) khách thiếu mã sắp `createdAt, _id`, mỗi lô một
 *     transaction (xem `assignBatch`). Lô nào commit rồi thì giữ; lỗi giữa chừng chạy lại sẽ nối tiếp phần còn thiếu.
 *  4. Đối soát: đếm còn thiếu, kiểm mã trùng, `$max` counter, ghi doc vết `script:crm-customer-codes`.
 * Idempotent: khách đã có mã không bao giờ bị đổi.
 */
export async function backfillCustomerCodes(
  client: MongoClient,
  db: Db,
  options: CustomerCodesBackfillOptions,
): Promise<CustomerCodesBackfillResult> {
  const { apply, log, afterBatch } = options;
  const batchSize = options.batchSize ?? CUSTOMER_CODES_DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError(
      `Kích thước lô phải là số nguyên >= 1, nhận: ${batchSize}`,
    );
  }

  const gate = await db
    .collection<{ _id: string }>(SYSTEM_COLLECTION)
    .findOne({ _id: CUSTOMER_CODES_GATE_ID }, { projection: { _id: 1 } });
  if (!gate) {
    log(
      `Sổ migration chưa có ${CUSTOMER_CODES_GATE_ID} (chưa áp dụng): bỏ qua, không bù mã.`,
    );
    return emptyResult(false);
  }

  const missingBefore = await countMissing(db);
  const missingSoftDeleted = await countMissing(db, {
    deletedAt: { $exists: true, $ne: null },
  });
  log(
    `Khách thiếu mã: ${missingBefore} (trong đó đã xóa mềm: ${missingSoftDeleted}).`,
  );
  if (!apply) {
    return emptyResult(true, {
      missingBefore,
      missingSoftDeleted,
      remaining: missingBefore,
    });
  }

  await syncCounterWithMaxCode(db);

  let assigned = 0;
  let batches = 0;
  for (;;) {
    const batch = await db
      .collection(CUSTOMERS)
      .find(MISSING_CODE_FILTER, { projection: { _id: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .limit(batchSize)
      .toArray();
    if (batch.length === 0) break;
    await assignBatch(
      client,
      db,
      batch.map((doc) => doc._id),
    );
    batches += 1;
    assigned += batch.length;
    log(
      `Lô ${batches}: đã cấp mã cho ${batch.length} khách (tổng ${assigned}).`,
    );
    if (afterBatch) await afterBatch({ batch: batches, assigned });
  }

  // Đối soát cuối: còn thiếu (phải 0), mã trùng (phải 0), counter không thấp hơn mã lớn nhất.
  await syncCounterWithMaxCode(db);
  const remaining = await countMissing(db);
  const duplicateCodes = await countDuplicateCodes(db);
  await db.collection<{ _id: string }>(SYSTEM_COLLECTION).updateOne(
    { _id: CUSTOMER_CODES_SCRIPT_DOC_ID },
    {
      $set: {
        lastRunAt: new Date(),
        assigned,
        remaining,
        by: CUSTOMER_CODES_SCRIPT_ACTOR,
      },
    },
    { upsert: true },
  );
  return {
    gateOpen: true,
    missingBefore,
    missingSoftDeleted,
    assigned,
    remaining,
    duplicateCodes,
    batches,
  };
}
