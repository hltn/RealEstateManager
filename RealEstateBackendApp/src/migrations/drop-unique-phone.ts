import type { Db } from 'mongodb';
import {
  hasMongoErrorCode,
  listCollectionIndexes,
  MONGO_INDEX_NOT_FOUND,
} from './mongo-index.util';

const CUSTOMERS = 'customers';
const PHONE_INDEX_NAME = 'phone_1';

/** SĐT khách đã ẩn danh (`anonymized:<id>`), cần trả về `null` sau khi bỏ unique. */
const ANONYMIZED_PHONE_PATTERN = '^anonymized:';

export interface DropUniquePhoneResult {
  /** Đã gỡ index `phone_1` đang unique ở lần chạy này. */
  droppedUnique: boolean;
  /** Đã tạo index `phone_1` thường (không unique) ở lần chạy này. */
  createdPlain: boolean;
  /** Số khách đã chuyển `phone: 'anonymized:...'` về `null` ở lần chạy này. */
  clearedAnonymized: number;
}

/**
 * Migration 011 `up` (post-up, MỘT CHIỀU, FR-01, FR-06, FR-21): bỏ ràng buộc unique của `customers.phone`.
 * Thứ tự BẮT BUỘC (đảo thứ tự sẽ `E11000`: nhiều khách `phone: null` trên index unique cũ):
 *  (1) `dropIndex('phone_1')` CHỈ khi nó đang unique (không có hoặc đã thường thì bỏ qua; index bị gỡ song song
 *      bởi tiến trình khác thì bỏ qua lỗi "không tồn tại").
 *  (2) Tạo `phone_1` THƯỜNG (không unique) nếu chưa có, giữ truy vấn theo SĐT nhanh.
 *  (3) Chuyển `phone: /^anonymized:/` thành `null` (chỉ sau bước 1).
 * Idempotent: chạy lại không đổi gì (index đã thường, không còn `anonymized:`).
 * Không có `down`: sau khi có SĐT trùng/null thì không dựng lại unique được.
 */
export async function dropUniquePhone(
  db: Db,
  log?: (message: string) => void,
): Promise<DropUniquePhoneResult> {
  const result: DropUniquePhoneResult = {
    droppedUnique: false,
    createdPlain: false,
    clearedAnonymized: 0,
  };
  const customers = db.collection(CUSTOMERS);
  const phoneIndex = (await listCollectionIndexes(db, CUSTOMERS)).find(
    (index) => index.name === PHONE_INDEX_NAME,
  );

  // (1) Gỡ index khi (và chỉ khi) đang unique.
  const hasPlainIndex = phoneIndex !== undefined && phoneIndex.unique !== true;
  if (phoneIndex?.unique === true) {
    try {
      await customers.dropIndex(PHONE_INDEX_NAME);
      result.droppedUnique = true;
    } catch (error) {
      if (!hasMongoErrorCode(error, MONGO_INDEX_NOT_FOUND)) throw error;
    }
  }

  // (2) Tạo index thường.
  if (!hasPlainIndex) {
    await customers.createIndex({ phone: 1 }, { name: PHONE_INDEX_NAME });
    result.createdPlain = true;
  }

  // (3) Chuyển phone ẩn danh về null (sau khi unique đã gỡ).
  const cleared = await customers.updateMany(
    { phone: { $regex: ANONYMIZED_PHONE_PATTERN } },
    { $set: { phone: null } },
  );
  result.clearedAnonymized = cleared.modifiedCount;

  log?.(
    `phone_1: ${result.droppedUnique ? 'đã gỡ unique' : 'không có unique'}, ` +
      `${result.createdPlain ? 'đã tạo index thường' : 'index thường đã có'}; ` +
      `chuyển ${result.clearedAnonymized} SĐT "anonymized:" về null`,
  );
  return result;
}
