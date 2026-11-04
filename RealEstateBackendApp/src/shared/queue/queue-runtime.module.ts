import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueRuntimeService } from './queue-runtime.service';

/**
 * `QueueRuntimeService` đứng riêng (không kéo `BullModule.forRoot` của `QueueModule`) để module nghiệp vụ dùng
 * được mà không mở sẵn kết nối queue nào khi `QUEUE_WORKERS_ENABLED` tắt.
 */
@Module({
  imports: [ConfigModule],
  providers: [QueueRuntimeService],
  exports: [QueueRuntimeService],
})
export class QueueRuntimeModule {}
