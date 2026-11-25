import type { Db, Document } from 'mongodb';

/** Mã lỗi Mongo dùng chung cho các migration thao tác index. */
export const MONGO_NAMESPACE_NOT_FOUND = 26;
export const MONGO_INDEX_NOT_FOUND = 27;
export const MONGO_INDEX_OPTIONS_CONFLICT = 85;
export const MONGO_INDEX_KEY_SPECS_CONFLICT = 86;

/** Lỗi driver có `code` khớp không (không phụ thuộc kiểu lớp lỗi). */
export const hasMongoErrorCode = (error: unknown, code: number): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === code;

/** Danh sách index của một collection; collection chưa có (DB mới) thì coi như rỗng. */
export async function listCollectionIndexes(
  db: Db,
  collection: string,
): Promise<Document[]> {
  try {
    return await db.collection(collection).indexes();
  } catch (error) {
    if (hasMongoErrorCode(error, MONGO_NAMESPACE_NOT_FOUND)) return [];
    throw error;
  }
}
