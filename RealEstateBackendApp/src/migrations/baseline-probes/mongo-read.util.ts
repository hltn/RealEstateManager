import type { Db, Document } from 'mongodb';

/** Collection có tồn tại không (chỉ đọc; `listIndexes` trên collection thiếu sẽ ném lỗi nên phải kiểm trước). */
export const collectionExists = async (
  db: Db,
  name: string,
): Promise<boolean> =>
  (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;

/** Danh sách index của collection; mảng rỗng nếu collection chưa tồn tại. */
export const listIndexesIfExists = async (
  db: Db,
  name: string,
): Promise<Document[]> =>
  (await collectionExists(db, name))
    ? db.collection(name).listIndexes().toArray()
    : [];
