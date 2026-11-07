import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  CRM_IMAGE_WORKER_OPTIONS,
  QueueNames,
} from '../../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import {
  AttachmentThumbnailJobNames,
  attachmentThumbnailJobId,
} from './attachment-thumbnail.constants';
import { AttachmentThumbnailProcessor } from './attachment-thumbnail.processor';

/**
 * Cầu nối queue `crm-image` (FR-26): xếp job `attachment.thumbnail` và đăng ký MỘT worker (concurrency 2) giao việc
 * cho `AttachmentThumbnailProcessor`. Worker chỉ chạy khi `QUEUE_WORKERS_ENABLED`; tắt thì `enqueue` là no-op
 * (ảnh vẫn `READY`, `thumbUrl = url`, bước bù thumbnail của T-54 xếp lại sau).
 */
@Injectable()
export class AttachmentThumbnailQueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AttachmentThumbnailQueueService.name);

  constructor(
    private readonly runtime: QueueRuntimeService,
    private readonly processor: AttachmentThumbnailProcessor,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.runtime.isEnabled()) return;
    this.runtime.registerWorker(
      QueueNames.CRM_IMAGE,
      (job) => this.handle(job),
      { concurrency: CRM_IMAGE_WORKER_OPTIONS.concurrency },
    );
  }

  /**
   * Xếp job thumbnail cho một ảnh (`jobId = thumb-{attachmentId}` nên xếp hai lần không nhân đôi). BEST-EFFORT: gọi
   * SAU khi transaction ghi ảnh đã commit; lỗi xếp hàng (Redis lỗi) chỉ ghi log, không làm hỏng upload.
   *
   * BullMQ bỏ qua `add` khi `jobId` còn trong Redis (completed giữ 1 giờ, failed giữ 7 ngày) mà vẫn trả về job cũ, nên
   * bước bù ảnh sẽ tưởng đã xếp. Luồng (cùng mẫu `PushSweepService`): không có job thì xếp; job `failed`/`completed`
   * thì xóa rồi xếp lại; job đang `waiting`/`active`/`delayed` thì giữ nguyên (không xếp trùng, không đụng job đang chạy).
   * @returns `true` chỉ khi job MỚI thật sự được gửi vào queue (đã có job đang chờ/chạy, runtime tắt hoặc lỗi => `false`).
   */
  async enqueue(attachmentId: string): Promise<boolean> {
    try {
      const jobId = attachmentThumbnailJobId(attachmentId);
      if (!(await this.clearFinishedJob(jobId))) return false;
      const job = await this.runtime.add(
        QueueNames.CRM_IMAGE,
        AttachmentThumbnailJobNames.THUMBNAIL,
        { attachmentId },
        { jobId },
      );
      return job !== null;
    } catch (error) {
      this.logger.warn(
        `Không xếp được job thumbnail của ảnh ${attachmentId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** `true` khi bên gọi nên `add`: chưa có job, hoặc job cũ đã chốt (failed/completed) và đã được xóa. */
  private async clearFinishedJob(jobId: string): Promise<boolean> {
    const job = await this.runtime.getJob(QueueNames.CRM_IMAGE, jobId);
    if (!job) return true;
    const state = await job.getState();
    if (state !== 'failed' && state !== 'completed') return false;
    await job.remove();
    return true;
  }

  async handle(
    job: Pick<Job, 'name'> &
      Partial<Pick<Job, 'data' | 'attemptsMade' | 'opts'>>,
  ): Promise<void> {
    if (job.name !== AttachmentThumbnailJobNames.THUMBNAIL) {
      // Ném lỗi (không nuốt): job lạ phải failed để không bị coi hoàn thành giả.
      throw new Error(`Job crm-image chưa được hỗ trợ: ${job.name}`);
    }
    await this.processor.process({
      data: (job.data as { attachmentId?: unknown } | undefined) ?? {},
      attemptsMade: job.attemptsMade ?? 0,
      opts: job.opts,
    });
  }
}
