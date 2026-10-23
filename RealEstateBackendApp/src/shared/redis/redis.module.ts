import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { buildRedisOptions, getKeyPrefix } from './redis.config';
import { REDIS_CLIENT } from './redis.constants';

/** Chờ kết nối sẵn sàng tối đa chừng này khi khởi động; Redis chưa lên thì vẫn cho app chạy (readiness sẽ đỏ). */
const STARTUP_WAIT_MS = 2000;

/**
 * Cung cấp 1 ioredis client dùng chung (token `REDIS_CLIENT`) cho toàn ứng dụng.
 * Backend stateless: idempotency/lock/cache đều đẩy ra Redis.
 *
 * Fail nhanh khi Redis chết (thay vì treo request HTTP, readiness báo đỏ ngay):
 * - `enableOfflineQueue: false`: lệnh gọi lúc mất kết nối bị từ chối NGAY, không xếp hàng chờ.
 * - `connectTimeout` 2s, `commandTimeout` 3s, `maxRetriesPerRequest: 1`.
 * - Tự kết nối lại nền với backoff tối đa 2s.
 * Có listener 'error' để lỗi kết nối chỉ ghi log, không làm sập process.
 * Đóng kết nối khi tắt ứng dụng (graceful shutdown) mà không chờ khi Redis đã chết.
 * BullMQ dùng kết nối riêng (xem QueueModule) vì yêu cầu cấu hình khác.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<Redis> => {
        const logger = new Logger('RedisClient');
        const client = new Redis({
          ...buildRedisOptions(config),
          keyPrefix: getKeyPrefix(config),
          enableOfflineQueue: false,
          connectTimeout: 2000,
          commandTimeout: 3000,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        client.on('error', (err) =>
          logger.error(`Lỗi kết nối Redis: ${err.message}`),
        );

        // Không có offline queue nên lệnh gửi trước khi kết nối xong sẽ bị từ chối: chờ ready ngắn lúc khởi động.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, STARTUP_WAIT_MS);
          client.once('ready', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        if (client.status !== 'ready') {
          logger.warn(
            'Redis chưa sẵn sàng khi khởi động; sẽ tự kết nối lại, readiness báo đỏ cho đến khi lên',
          );
        }
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'ready') {
      await this.client.quit().catch(() => this.client.disconnect());
    } else {
      // Redis đã chết/đang kết nối lại: quit() sẽ không bao giờ được trả lời, ngắt luôn.
      this.client.disconnect();
    }
  }
}
