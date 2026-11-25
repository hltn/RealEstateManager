import { ClientSession, Connection } from 'mongoose';
import {
  discardAfterCommit,
  resetAfterCommit,
  runAfterCommit,
  takeAfterCommit,
} from './after-commit.util';

/** Mức đọc/ghi an toàn cho nghiệp vụ nhiều collection: đọc snapshot nhất quán, ghi đã nhân bản đa số node. */
const DEFAULT_TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
} as const;

/**
 * Chạy `work` trong một MongoDB transaction (bắt buộc khi cập nhật từ 2 collection trở lên).
 *
 * - Thành công ⇒ commit; ném lỗi ⇒ abort toàn bộ, lỗi được ném lại nguyên vẹn cho caller.
 * - Tự retry khi gặp TransientTransactionError / UnknownTransactionCommitResult
 *   (do `connection.transaction` của Mongoose), nên `work` phải IDEMPOTENT với
 *   phần ngoài DB: KHÔNG gửi push/enqueue job/gọi API ngoài trực tiếp trong `work` —
 *   đăng ký chúng bằng `registerAfterCommit(session, fn)` (chỉ chạy sau commit thành công, không chạy khi rollback,
 *   danh sách được xóa ở đầu mỗi lần chạy `work` nên retry không chạy hai lần, hàm lỗi chỉ ghi log).
 * - Mọi thao tác DB trong `work` phải truyền `{ session }` (hoặc `.session(session)`),
 *   nếu không sẽ nằm NGOÀI transaction.
 * - Yêu cầu MongoDB Replica Set (hoặc mongos); chạy standalone sẽ lỗi
 *   "Transaction numbers are only allowed on a replica set member or mongos".
 *
 * Ví dụ:
 *   await withTransaction(this.connection, async (session) => {
 *     const [customer] = await this.customerModel.create([dto], { session });
 *     await this.auditModel.create([{ customerId: customer._id }], { session });
 *   });
 */
export async function withTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  let usedSession: ClientSession | undefined;
  let result: T;
  try {
    result = await connection.transaction(async (session) => {
      usedSession = session;
      resetAfterCommit(session); // retry chạy lại `work`: bỏ các hàm đã đăng ký ở lần trước
      return work(session);
    }, DEFAULT_TRANSACTION_OPTIONS);
  } catch (error) {
    if (usedSession) discardAfterCommit(usedSession);
    throw error;
  }
  if (usedSession) await runAfterCommit(takeAfterCommit(usedSession));
  return result;
}
