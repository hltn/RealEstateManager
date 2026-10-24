import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, JobsOptions, Queue, RepeatOptions, Worker } from 'bullmq';
import { withTimeout } from '../../common/utils/with-timeout.util';
import { buildBullPrefix, buildRedisOptions } from '../redis/redis.config';
import { isQueueWorkersEnabled } from './queue-runtime.config';
import { DEFAULT_JOB_OPTIONS } from './queue.constants';

export type QueueJobHandler = (job: Job) => Promise<unknown>;

/** Một job lặp (repeatable) của một queue; `id` cố định nên đăng ký lại (nhiều instance, restart) luôn idempotent. */
export interface JobSchedulerSpec {
  id: string;
  repeat: Omit<RepeatOptions, 'key'>;
  jobName: string;
  data?: Record<string, unknown>;
  opts?: JobsOptions;
}

const SCHEDULER_ATTEMPTS = 5;
const SCHEDULER_ATTEMPT_TIMEOUT_MS = 10_000;
const SCHEDULER_RETRY_BASE_MS = 1_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/**
 * Hạ tầng BullMQ dùng chung cho module nghiệp vụ (worker, job lặp, đóng gọn khi tắt app):
 * - `registerWorker`: một worker cho một queue, log lỗi (không để 'error' làm sập process), đóng chờ job đang chạy;
 * - `upsertSchedulers`: đăng ký job lặp bằng `upsertJobScheduler` (id cố định, idempotent khi nhiều instance/khởi
 *   động lại cùng đăng ký; thử lại có backoff khi Redis chưa sẵn sàng thay vì làm app không khởi động);
 * - `add`: đẩy job với `jobId` do bên gọi đặt (cùng jobId = không tạo job thứ hai).
 * Mọi hàm là no-op khi `isEnabled()` sai (`QUEUE_WORKERS_ENABLED`, xem `queue-runtime.config.ts`): kết nối Redis chỉ
 * được mở lười khi thật sự dùng nên test/instance chỉ phục vụ HTTP không để lại handle.
 */
@Injectable()
export class QueueRuntimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueRuntimeService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private closing = false;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return isQueueWorkersEnabled(this.config);
  }

  registerWorker(
    queueName: string,
    handler: QueueJobHandler,
    options: { concurrency?: number } = {},
  ): void {
    if (!this.isEnabled() || this.closing) return;
    const worker = new Worker(queueName, handler, {
      connection: buildRedisOptions(this.config),
      prefix: buildBullPrefix(this.config),
      concurrency: options.concurrency ?? 1,
    });
    worker.on('error', (error) =>
      this.logger.error(`Worker ${queueName} lỗi: ${error.message}`),
    );
    worker.on('failed', (job, error) =>
      this.logger.warn(
        `Job ${queueName}/${job?.name ?? '?'} (#${job?.id ?? '?'}) thất bại lần ${job?.attemptsMade ?? '?'}: ${error.message}`,
      ),
    );
    this.workers.push(worker);
  }

  /** Đăng ký/cập nhật job lặp; thất bại hết lượt thử thì ném lỗi để bên gọi ghi log (job lặp sẽ thiếu đến lần khởi động sau). */
  async upsertSchedulers(
    queueName: string,
    specs: JobSchedulerSpec[],
  ): Promise<void> {
    if (!this.isEnabled()) return;
    for (let attempt = 1; ; attempt += 1) {
      if (this.closing) return;
      try {
        const queue = this.getQueue(queueName);
        await withTimeout(
          Promise.all(
            specs.map((spec) =>
              queue.upsertJobScheduler(spec.id, spec.repeat, {
                name: spec.jobName,
                data: spec.data ?? {},
                opts: spec.opts,
              }),
            ),
          ),
          SCHEDULER_ATTEMPT_TIMEOUT_MS,
          `Đăng ký job lặp của ${queueName} quá thời gian chờ`,
        );
        return;
      } catch (error) {
        if (attempt >= SCHEDULER_ATTEMPTS) throw error;
        this.logger.warn(
          `Đăng ký job lặp của ${queueName} lần ${attempt} thất bại (${(error as Error).message}), thử lại`,
        );
        await sleep(SCHEDULER_RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  /** Đẩy một job với `jobId` cố định (đã tồn tại thì BullMQ bỏ qua, không nhân đôi). Trả `null` khi runtime tắt. */
  async add(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    options: JobsOptions & { jobId: string },
  ): Promise<Job | null> {
    if (!this.isEnabled()) return null;
    return this.getQueue(queueName).add(jobName, data, options);
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    // Worker đóng trước (chờ job đang chạy xong) rồi mới đóng kết nối queue.
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await Promise.allSettled(
      [...this.queues.values()].map((queue) => queue.close()),
    );
    this.workers.length = 0;
    this.queues.clear();
  }

  private getQueue(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, {
        connection: buildRedisOptions(this.config),
        prefix: buildBullPrefix(this.config),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      queue.on('error', (error) =>
        this.logger.error(`Queue ${queueName} lỗi: ${error.message}`),
      );
      this.queues.set(queueName, queue);
    }
    return queue;
  }
}
