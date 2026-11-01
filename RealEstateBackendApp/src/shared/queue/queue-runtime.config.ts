import { ConfigService } from '@nestjs/config';

/** Biến môi trường bật/tắt worker + scheduler BullMQ của tiến trình này. */
export const QUEUE_WORKERS_ENABLED_KEY = 'QUEUE_WORKERS_ENABLED';

const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'on']);

/**
 * Tiến trình này có chạy worker/scheduler BullMQ không (`QUEUE_WORKERS_ENABLED`).
 *
 * - Có cấu hình tường minh (`true|1|yes|on` bật, giá trị khác tắt) thì theo cấu hình: cho phép tách tiến trình
 *   chỉ nhận request HTTP (tắt) khỏi tiến trình worker (bật) khi scale ngang.
 * - Không cấu hình: bật, TRỪ khi `NODE_ENV=test` (Jest tự đặt) để test không mở kết nối Redis nền,
 *   không treo Jest / để lại open handle. Test cần worker thật thì đặt `QUEUE_WORKERS_ENABLED=true`.
 */
export function isQueueWorkersEnabled(config: ConfigService): boolean {
  const raw = config.get<string | boolean | undefined>(
    QUEUE_WORKERS_ENABLED_KEY,
  );
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return TRUTHY_VALUES.has(raw.trim().toLowerCase());
  }
  return process.env.NODE_ENV !== 'test';
}
