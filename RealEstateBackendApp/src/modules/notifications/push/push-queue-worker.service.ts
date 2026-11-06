import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  PUSH_WORKER_OPTIONS,
  QueueNames,
} from '../../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { PushCleanupService } from './push-cleanup.service';
import {
  PushDeliveryProcessor,
  PushSendJobLike,
} from './push-delivery.processor';
import { PushJobNames } from './push-queue.constants';
import { PUSH_SWEEP_EVERY_MS, PushSweepService } from './push-sweep.service';

/** Nhịp job lặp dọn subscription: 6 giờ (Architecture 5.6). */
export const PUSH_CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * MỘT worker duy nhất cho queue `push` (`QueueNames.PUSH`), chọn việc theo tên job. Không đăng ký nhiều worker trên
 * cùng queue vì mỗi worker sẽ nhận cả job không phải của mình. `push.send` giao cho `PushDeliveryProcessor`; `push.sweep`/`push.cleanup` giao cho
 * service riêng (router mỏng). Đồng thời đăng ký hai job lặp bằng `upsertSchedulers` (id cố định, idempotent
 * khi nhiều instance/khởi động lại cùng đăng ký). Chỉ chạy khi `QUEUE_WORKERS_ENABLED`.
 */
@Injectable()
export class PushQueueWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(PushQueueWorker.name);

  constructor(
    private readonly runtime: QueueRuntimeService,
    private readonly cleanup: PushCleanupService,
    private readonly delivery: PushDeliveryProcessor,
    private readonly sweep: PushSweepService,
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
        {
          id: 'push-sweep',
          repeat: { every: PUSH_SWEEP_EVERY_MS },
          jobName: PushJobNames.SWEEP,
          opts: { attempts: 1 },
        },
      ])
      .catch((error: Error) =>
        this.logger.error(`Không đăng ký được job lặp push: ${error.message}`),
      );
  }

  async handle(
    job: Pick<Job, 'name'> & Partial<PushSendJobLike>,
  ): Promise<void> {
    switch (job.name) {
      case PushJobNames.SEND:
        await this.delivery.process({
          data: job.data ?? {},
          attemptsMade: job.attemptsMade ?? 0,
          opts: job.opts,
        });
        return;
      case PushJobNames.CLEANUP:
        await this.cleanup.run(new Date());
        return;
      case PushJobNames.SWEEP:
        await this.sweep.run(new Date());
        return;
      default:
        // Ném lỗi (không nuốt): job lạ phải failed để không bị coi hoàn thành giả.
        throw new Error(`Job push chưa được hỗ trợ: ${job.name}`);
    }
  }
}
