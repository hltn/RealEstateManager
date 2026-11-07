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
   * @returns `true` khi job đã được gửi vào queue.
   */
  async enqueue(attachmentId: string): Promise<boolean> {
    try {
      const job = await this.runtime.add(
        QueueNames.CRM_IMAGE,
        AttachmentThumbnailJobNames.THUMBNAIL,
        { attachmentId },
        { jobId: attachmentThumbnailJobId(attachmentId) },
      );
      return job !== null;
    } catch (error) {
      this.logger.warn(
        `Không xếp được job thumbnail của ảnh ${attachmentId}: ${(error as Error).message}`,
      );
      return false;
    }
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
