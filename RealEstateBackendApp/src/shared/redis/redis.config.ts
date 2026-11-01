import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'bullmq';

const DEFAULT_KEY_PREFIX = 'rem:';
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/**
 * Đổi `REDIS_URL` (redis://[user:pass@]host:port[/db], `rediss://` = TLS) thành
 * RedisOptions của ioredis. Dùng chung cho client key-value và kết nối BullMQ để
 * hai nơi không lệch cấu hình.
 *
 * Ném lỗi rõ ràng (fail-fast lúc khởi động) khi URL không hợp lệ.
 */
export function buildRedisOptions(config: ConfigService): RedisOptions {
  const rawUrl = config.get<string>('REDIS_URL')?.trim() || DEFAULT_REDIS_URL;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      'REDIS_URL không hợp lệ, định dạng đúng: redis://[user:pass@]host:port[/db]',
    );
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL phải bắt đầu bằng redis:// hoặc rediss://');
  }

  const dbFromPath = url.pathname.replace('/', '');
  const options: RedisOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    db: dbFromPath ? Number(dbFromPath) : 0,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') options.tls = {};
  if (Number.isNaN(options.db)) {
    throw new Error('REDIS_URL có số database không hợp lệ');
  }
  return options;
}

/** Tiền tố key Redis chung của ứng dụng (`REDIS_KEY_PREFIX`, mặc định `rem:`). */
export function getKeyPrefix(config: ConfigService): string {
  return config.get<string>('REDIS_KEY_PREFIX') ?? DEFAULT_KEY_PREFIX;
}

/**
 * Prefix của BullMQ, suy ra từ `REDIS_KEY_PREFIX` để nhiều môi trường dùng chung 1 Redis
 * không đụng queue của nhau: `rem:` thành `rem:bull` (BullMQ tự nối `:<tên-queue>`).
 * Mọi nơi tạo Queue/Worker/QueueEvents phải dùng cùng giá trị này.
 */
export function buildBullPrefix(config: ConfigService): string {
  return `${getKeyPrefix(config).replace(/:+$/, '')}:bull`;
}
