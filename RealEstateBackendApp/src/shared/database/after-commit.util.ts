import { Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';

/** Hàm chạy SAU khi transaction commit thành công (ví dụ xếp job BullMQ); có thể bất đồng bộ. */
export type AfterCommitCallback = () => void | Promise<void>;

const logger = new Logger('AfterCommit');

/** Hàm chờ chạy, theo từng session do `withTransaction` tạo; session không có trong bảng = không nằm trong withTransaction. */
const pendingBySession = new WeakMap<ClientSession, AfterCommitCallback[]>();

/** Chạy một callback, nuốt mọi lỗi (đồng bộ lẫn bất đồng bộ) và chỉ ghi log: không bao giờ ném. */
async function runSafely(callback: AfterCommitCallback): Promise<void> {
  try {
    await callback();
  } catch (error) {
    logger.warn(
      `Hàm sau commit thất bại (bỏ qua, kết quả đã commit không bị ảnh hưởng): ${(error as Error)?.message ?? String(error)}`,
    );
  }
}

/**
 * Đăng ký hàm chạy sau khi transaction của `session` COMMIT thành công.
 * - Rollback/abort ⇒ không chạy; `work` bị retry (TransientTransactionError) ⇒ danh sách bị xóa ở đầu mỗi lần chạy nên
 *   mỗi hàm chỉ chạy tối đa một lần cho lần chạy đã commit;
 * - Nhiều hàm chạy lần lượt theo thứ tự đăng ký; hàm lỗi chỉ ghi log, không ném, không chặn hàm sau;
 * - `session` không do `withTransaction` tạo (hoặc không truyền) ⇒ chạy ngay (không có transaction để chờ).
 */
export function registerAfterCommit(
  session: ClientSession | undefined | null,
  callback: AfterCommitCallback,
): Promise<void> | void {
  const pending = session ? pendingBySession.get(session) : undefined;
  if (!pending) return runSafely(callback);
  pending.push(callback);
}

/** Dùng nội bộ bởi `withTransaction`: xóa danh sách (đầu mỗi lần chạy `work`, kể cả retry). */
export function resetAfterCommit(session: ClientSession): void {
  pendingBySession.set(session, []);
}

/** Dùng nội bộ bởi `withTransaction`: lấy và bỏ theo dõi danh sách hàm của session. */
export function takeAfterCommit(session: ClientSession): AfterCommitCallback[] {
  const pending = pendingBySession.get(session) ?? [];
  pendingBySession.delete(session);
  return pending;
}

/** Dùng nội bộ bởi `withTransaction`: chạy lần lượt, không bao giờ ném. */
export async function runAfterCommit(
  callbacks: AfterCommitCallback[],
): Promise<void> {
  for (const callback of callbacks) {
    await runSafely(callback);
  }
}

/** Dùng nội bộ bởi `withTransaction`: bỏ theo dõi session (rollback). */
export function discardAfterCommit(session: ClientSession): void {
  pendingBySession.delete(session);
}
