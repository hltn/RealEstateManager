import { Logger } from '@nestjs/common';
import { IdempotencyService } from '../services/idempotency.service';

const logger = new Logger('IdempotentRequest');

/**
 * Bọc 1 thao tác theo `X-Idempotency-Key` (chống click đúp / retry):
 * 1. Không có key thì chạy thẳng `work`.
 * 2. Đã có response lưu trước đó thì trả lại, không chạy lại.
 * 3. Giành khóa NGUYÊN TỬ (SET NX): không giành được (đang có request cùng key chạy)
 *    thì gọi `onInProgress` (trả thông báo hoặc ném 409 tùy endpoint).
 * 4. Chạy `work`, lưu response, rồi nhả khóa trong `finally`.
 *
 * Việc lưu response và nhả khóa là best-effort: lỗi Redis ở bước này chỉ ghi cảnh báo,
 * KHÔNG biến một request đã xử lý xong thành 500 (khóa vẫn tự hết hạn theo TTL).
 * Lỗi Redis ở bước đọc cache/giành khóa thì ném lên (không đảm bảo được tính duy nhất thì không chạy).
 */
export async function runIdempotent<T>(
  idempotency: IdempotencyService,
  key: string | undefined,
  work: () => Promise<T>,
  onInProgress: () => T,
): Promise<T> {
  if (!key) return work();

  const cached = await idempotency.get<T>(key);
  if (cached) return cached;
  if (!(await idempotency.tryMarkInFlight(key))) return onInProgress();

  try {
    const response = await work();
    await bestEffort(`lưu response idempotency ${key}`, () =>
      idempotency.set(key, response),
    );
    return response;
  } finally {
    await bestEffort(`nhả khóa idempotency ${key}`, () =>
      idempotency.clearInFlight(key),
    );
  }
}

/** Chạy một thao tác phụ, nuốt lỗi và chỉ cảnh báo (dùng cho dọn dẹp sau khi nghiệp vụ đã xong). */
export async function bestEffort(
  label: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    logger.warn(`${label} thất bại: ${(error as Error)?.message}`);
  }
}
