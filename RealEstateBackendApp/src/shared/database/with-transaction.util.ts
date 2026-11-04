import { ClientSession, Connection } from 'mongoose';

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
 *   phần ngoài DB: KHÔNG gửi push/enqueue job/gọi API ngoài bên trong `work` —
 *   làm các việc đó SAU khi `withTransaction` trả về (đã commit).
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
export function withTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  return connection.transaction(work, DEFAULT_TRANSACTION_OPTIONS);
}
