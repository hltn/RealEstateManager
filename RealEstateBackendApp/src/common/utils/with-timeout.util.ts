/**
 * Giới hạn thời gian chờ của một Promise. Hết hạn thì reject với `Error(message)`;
 * timer luôn được dọn để không giữ process sống.
 * Lưu ý: không hủy được thao tác gốc, chỉ ngừng chờ nó.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = `Quá thời gian chờ ${timeoutMs}ms`,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
