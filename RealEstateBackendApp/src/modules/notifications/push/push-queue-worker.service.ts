import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  PUSH_WORKER_OPTIONS,
  QueueNames,
} from '../../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { PushCleanupService } from './push-cleanup.service';
import { PushJobNames } from './push-queue.constants';

/** Nhịp job lặp dọn subscription: 6 giờ (Architecture 5.6). */
export const PUSH_CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * MỘT worker duy nhất cho queue `push` (`QueueNames.PUSH`), chọn việc theo tên job. Không đăng ký nhiều worker trên
 * cùng queue vì mỗi worker sẽ nhận cả job không phải của mình. Các job khác (`push.send` T-31, `push.sweep` T-32)
 * thêm nhánh vào `handle`. Đồng thời đăng ký job lặp `push.cleanup` bằng `upsertSchedulers` (id cố định, idempotent
 * khi nhiều instance/khởi động lại cùng đăng ký). Chỉ chạy khi `QUEUE_WORKERS_ENABLED`.
 */
@Injectable()
export class PushQueueWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(PushQueueWorker.name);

  constructor(
    private readonly runtime: QueueRuntimeService,
    private readonly cleanup: PushCleanupService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.runtime.isEnabled()) return;
    this.runtime.registerWorker(QueueNames.PUSH, (job) => this.handle(job), {
      concurrency: PUSH_WORKER_OPTIONS.concurrency,
      limiter: PUSH_WORKER_OPTIONS.limiter,
    });
    // Không chặn khởi động: Redis chưa sẵn sàng thì thử lại nền, hết lượt mới ghi lỗi.
    void this.runtime
      .upsertSchedulers(QueueNames.PUSH, [
        {
          id: 'push-cleanup',
          repeat: { every: PUSH_CLEANUP_EVERY_MS },
          jobName: PushJobNames.CLEANUP,
          opts: { attempts: 1 },
        },
      ])
      .catch((error: Error) =>
        this.logger.error(`Không đăng ký được job lặp push: ${error.message}`),
      );
  }

  async handle(job: Pick<Job, 'name'>): Promise<void> {
    switch (job.name) {
      case PushJobNames.CLEANUP:
        await this.cleanup.run(new Date());
        return;
      default:
        // Ném lỗi (không nuốt): job chưa có handler phải failed/retry để không bị coi hoàn thành giả (T-31 thêm nhánh thật).
        throw new Error(`Job push chưa được hỗ trợ: ${job.name}`);
    }
  }
}
