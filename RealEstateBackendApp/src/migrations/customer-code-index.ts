import { isDeepStrictEqual } from 'util';
import type { Db, Document } from 'mongodb';
import {
  hasMongoErrorCode,
  listCollectionIndexes,
  MONGO_INDEX_KEY_SPECS_CONFLICT,
  MONGO_INDEX_OPTIONS_CONFLICT,
} from './mongo-index.util';
import {
  COUNTER_KEY,
  CUSTOMER_CODE_INDEX,
} from '../modules/crm/customers/customer-code.constants';

const CUSTOMERS = 'customers';
const COUNTERS = 'counters';

export interface CustomerCodeIndexResult {
  /** `true` nếu lần này vừa tạo index; `false` nếu index đã có đúng spec (chạy lại, no-op). */
  indexCreated: boolean;
  /** `true` nếu lần này vừa tạo doc counter (`seq: 0`); `false` nếu counter đã có (giữ nguyên `seq`). */
  counterCreated: boolean;
}

/** Index hiện có đã khớp từng tùy chọn của `CUSTOMER_CODE_INDEX` chưa (key theo thứ tự, unique, partial, không sparse/TTL/collation). */
function matchesCustomerCodeIndex(existing: Document): boolean {
  const { key, options } = CUSTOMER_CODE_INDEX;
  return (
    isDeepStrictEqual(
      Object.entries((existing.key as Document | undefined) ?? {}),
      Object.entries(key),
    ) &&
    existing.unique === options.unique &&
    isDeepStrictEqual(
      existing.partialFilterExpression,
      options.partialFilterExpression,
    ) &&
    !existing.sparse &&
    existing.expireAfterSeconds === undefined &&
    existing.collation === undefined
  );
}

const conflictError = (detail: string): Error =>
  new Error(
    `Migration 010: index "${CUSTOMER_CODE_INDEX.options.name}" trên "${CUSTOMERS}" xung đột với định nghĩa mong đợi ` +
      `(${detail}). Migration KHÔNG tự xóa index: xử lý tay (kiểm tra index rồi gỡ/đổi tên) và chạy lại.`,
  );

/**
 * Migration 010 `up` (FR-07, FR-21): chỉ THÊM, không bù mã, không đụng `phone`.
 * (1) Tạo index partial unique `customerCode_1` bằng `CUSTOMER_CODE_INDEX`: partial (`$type: 'string'`) nên khách chưa
 *     có mã (do image cũ ghi chen giữa 6b và `up`) không bị `E11000`. Nếu đã có index cùng tên mà KHÁC tùy chọn thì ném
 *     lỗi rõ ràng, không tự xóa. Idempotent: index đúng spec thì bỏ qua.
 * (2) Upsert doc `counters` `CUSTOMER_CODE` với `$setOnInsert { seq: 0 }`: chạy lại không ghi đè `seq` đã tăng.
 */
export async function createCustomerCodeIndex(
  db: Db,
  log?: (message: string) => void,
): Promise<CustomerCodeIndexResult> {
  const { key, options } = CUSTOMER_CODE_INDEX;
  const existing = (await listCollectionIndexes(db, CUSTOMERS)).find(
    (index) => index.name === options.name,
  );

  let indexCreated = false;
  if (existing) {
    if (!matchesCustomerCodeIndex(existing)) {
      throw conflictError(
        `hiện có ${JSON.stringify({
          key: existing.key,
          unique: existing.unique,
          partialFilterExpression: existing.partialFilterExpression,
        })}`,
      );
    }
  } else {
    try {
      await db.collection(CUSTOMERS).createIndex(
        { ...key },
        {
          ...options,
          // Sao chép để driver không giữ tham chiếu vào hằng số `as const` dùng chung.
          partialFilterExpression: { ...options.partialFilterExpression },
        },
      );
      indexCreated = true;
    } catch (error) {
      if (
        hasMongoErrorCode(error, MONGO_INDEX_OPTIONS_CONFLICT) ||
        hasMongoErrorCode(error, MONGO_INDEX_KEY_SPECS_CONFLICT)
      ) {
        throw conflictError(
          'đã có index khác trùng khóa {customerCode: 1} nhưng khác tên/tùy chọn',
        );
      }
      throw error;
    }
  }

  const counter = await db
    .collection<{ _id: string; seq: number }>(COUNTERS)
    .updateOne(
      { _id: COUNTER_KEY },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );
  const counterCreated = counter.upsertedCount > 0;

  log?.(
    `Index ${options.name}: ${indexCreated ? 'đã tạo' : 'đã có sẵn đúng spec'}; ` +
      `counter ${COUNTER_KEY}: ${counterCreated ? 'đã tạo (seq 0)' : 'đã có, giữ nguyên'}`,
  );
  return { indexCreated, counterCreated };
}
