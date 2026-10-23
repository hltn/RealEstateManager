import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { buildBullPrefix, buildRedisOptions } from '../redis/redis.config';
import { HealthPingProcessor } from './health-ping.processor';
import { QueuePingService } from './queue-ping.service';
import { DEFAULT_JOB_OPTIONS, QueueNames } from './queue.constants';

/**
 * Nền tảng BullMQ dùng chung (kết nối Redis + job options mặc định) và hàng đợi `health-ping`.
 * Module nghiệp vụ tự đăng ký queue của mình bằng `BullModule.registerQueue({ name })`
 * — không cần cấu hình lại kết nối.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisOptions(config),
        prefix: buildBullPrefix(config),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: QueueNames.HEALTH_PING }),
  ],
  providers: [HealthPingProcessor, QueuePingService],
  exports: [BullModule, QueuePingService],
})
export class QueueModule {}
