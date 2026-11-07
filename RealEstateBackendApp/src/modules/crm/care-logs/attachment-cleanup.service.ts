import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import {
  FILE_STORAGE,
  StorageBucket,
} from '../../../shared/storage/file-storage.interface';
import type { IFileStorage } from '../../../shared/storage/file-storage.interface';
import { AttachmentThumbnailQueueService } from './attachment-thumbnail-queue.service';
import {
  AttachmentKind,
  AttachmentStatus,
  ORPHAN_ATTACHMENT_TTL_MS,
  ThumbStatus,
} from './care-log.constants';
import {
  CrmAttachment,
  CrmAttachmentDocument,
} from './schemas/crm-attachment.schema';
import { storedKeysOf } from './utils/stored-keys.util';

const PURGE_BATCH_SIZE = 100;
/** Trần số lô mỗi lần chạy: không để một lần dọn chiếm cả giờ khi tồn đọng lớn. */
const MAX_BATCHES_PER_RUN = 20;
/** Số ảnh cũ tối đa được xếp lại job thumbnail mỗi lần chạy (FR-26): tránh làm đầy queue `crm-image` một lúc. */
export const THUMBNAIL_BACKFILL_BATCH_SIZE = 200;

export interface CleanupResult {
  /** Ảnh READY chưa gắn quá hạn bị chuyển sang REMOVED. */
  expired: number;
  /** File đã xóa khỏi kho lưu trữ. */
  purged: number;
}

/**
 * Dọn ảnh đính kèm (tài liệu 04 mục 6.6, dữ liệu kỹ thuật tạm): (1) ảnh tải lên nhưng chưa gắn quá 24 giờ => REMOVED;
 * (2) xóa khỏi kho lưu trữ mọi file của ảnh REMOVED chưa có `purgedAt` (kể cả ảnh bị gỡ lúc ẩn danh hóa khách hoặc
 * lần xóa trực tiếp thất bại), gồm cả thumbnail (`thumbKey`); (3) bù thumbnail cho ảnh cũ (FR-26, xem `backfillThumbnails`).
 * Idempotent và an toàn khi nhiều instance cùng chạy. Chạy mỗi giờ bằng job lặp BullMQ `attachments.cleanup` (M5, `CrmSchedulerService`).
 */
@Injectable()
export class AttachmentCleanupService {
  private readonly logger = new Logger(AttachmentCleanupService.name);

  constructor(
    @InjectModel(CrmAttachment.name)
    private readonly attachmentModel: Model<CrmAttachmentDocument>,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    private readonly featureFlags: FeatureFlagService,
    private readonly thumbnailQueue: AttachmentThumbnailQueueService,
  ) {}

  async runScheduled(): Promise<void> {
    if (
      !this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED) ||
      !this.featureFlags.isEnabled(FeatureFlag.CRM_ATTACHMENTS) ||
      !this.storage.isConfigured()
    ) {
      return;
    }
    try {
      const result = await this.cleanup();
      if (result.expired > 0 || result.purged > 0) {
        this.logger.log(
          `Dọn ảnh đính kèm: ${result.expired} ảnh quá hạn, ${result.purged} file đã xóa`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Dọn ảnh đính kèm thất bại: ${(error as Error).message}`,
      );
    }
    // Bù thumbnail tách riêng: dọn lỗi không chặn bù, bù lỗi không làm hỏng lần dọn (đã xong ở trên).
    try {
      const queued = await this.backfillThumbnails();
      if (queued > 0) {
        this.logger.log(`Bù thumbnail: đã xếp lại ${queued} ảnh cũ`);
      }
    } catch (error) {
      this.logger.error(`Bù thumbnail thất bại: ${(error as Error).message}`);
    }
  }

  /**
   * Bù thumbnail cho ảnh cũ (FR-26, ảnh tải lên trước khi có job thumbnail hoặc lần xếp job trước bị mất): lấy tối đa
   * `THUMBNAIL_BACKFILL_BATCH_SIZE` ảnh còn dùng (READY/ATTACHED, chưa xóa file) chưa có `thumbKey` và `thumbStatus` khác
   * `FAILED` (thiếu field = ảnh cũ, tính như `NONE`), cũ nhất trước, rồi xếp job `attachment.thumbnail`. Idempotent:
   * `jobId` theo ảnh nên xếp lại ảnh đang chờ không nhân đôi, ảnh đã có thumbnail hoặc `FAILED` không bị chọn lại.
   * Mỗi lần chỉ một lô (không lặp trong lần chạy vì ảnh đã xếp hàng nhưng chưa xử lý sẽ bị chọn lại); job lặp mỗi giờ
   * nên phần còn lại được bù ở các lần sau.
   * @returns số ảnh đã xếp job thành công.
   */
  async backfillThumbnails(): Promise<number> {
    const rows = await this.attachmentModel
      .find({
        kind: AttachmentKind.CARE_LOG_IMAGE,
        status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
        purgedAt: null,
        thumbKey: null,
        thumbStatus: { $ne: ThumbStatus.FAILED },
      })
      .select('_id')
      .sort({ createdAt: 1 })
      .limit(THUMBNAIL_BACKFILL_BATCH_SIZE)
      .lean()
      .exec();
    let queued = 0;
    for (const row of rows) {
      if (await this.thumbnailQueue.enqueue(String(row._id))) queued += 1;
    }
    return queued;
  }

  async cleanup(now = new Date()): Promise<CleanupResult> {
    const cutoff = new Date(now.getTime() - ORPHAN_ATTACHMENT_TTL_MS);
    const expired = await this.attachmentModel
      .updateMany(
        {
          kind: AttachmentKind.CARE_LOG_IMAGE,
          status: AttachmentStatus.READY,
          careLogId: null,
          createdAt: { $lt: cutoff },
        },
        { $set: { status: AttachmentStatus.REMOVED, removedAt: now } },
      )
      .exec();

    let purged = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const rows = await this.attachmentModel
        .find({ status: AttachmentStatus.REMOVED, purgedAt: null })
        .select('fileKey thumbKey')
        .limit(PURGE_BATCH_SIZE)
        .lean()
        .exec();
      if (rows.length === 0) break;
      const done: typeof rows = [];
      for (const row of rows) {
        try {
          // Xóa cả thumbnail: chỉ đánh dấu `purgedAt` khi mọi file của ảnh đã xóa (xóa file không tồn tại là no-op).
          for (const key of storedKeysOf(row)) {
            await this.storage.delete(StorageBucket.ATTACHMENTS, key);
          }
          done.push(row);
        } catch (error) {
          this.logger.warn(
            `Không xóa được file ${row.fileKey}: ${(error as Error).message}`,
          );
        }
      }
      if (done.length === 0) break;
      await this.attachmentModel
        .updateMany(
          { _id: { $in: done.map((row) => row._id) } },
          { $set: { purgedAt: now } },
        )
        .exec();
      purged += done.length;
      if (done.length < rows.length) break;
    }
    return { expired: expired.modifiedCount, purged };
  }
}
