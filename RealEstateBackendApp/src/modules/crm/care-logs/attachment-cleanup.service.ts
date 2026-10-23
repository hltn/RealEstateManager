import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import {
  AttachmentKind,
  AttachmentStatus,
  ORPHAN_ATTACHMENT_TTL_MS,
} from './care-log.constants';
import {
  CrmAttachment,
  CrmAttachmentDocument,
} from './schemas/crm-attachment.schema';

const PURGE_BATCH_SIZE = 100;
/** Trần số lô mỗi lần chạy: không để một lần dọn chiếm cả giờ khi tồn đọng lớn. */
const MAX_BATCHES_PER_RUN = 20;

export interface CleanupResult {
  /** Ảnh READY chưa gắn quá hạn bị chuyển sang REMOVED. */
  expired: number;
  /** File đã xóa khỏi kho lưu trữ. */
  purged: number;
}

/**
 * Dọn ảnh đính kèm (tài liệu 04 mục 6.6, dữ liệu kỹ thuật tạm): (1) ảnh tải lên nhưng chưa gắn quá 24 giờ => REMOVED;
 * (2) xóa khỏi kho lưu trữ mọi file của ảnh REMOVED chưa có `purgedAt` (kể cả ảnh bị gỡ lúc ẩn danh hóa khách hoặc
 * lần xóa trực tiếp thất bại). Idempotent và an toàn khi nhiều instance cùng chạy. Chạy mỗi giờ; BullMQ repeatable
 * sẽ thay thế khi M5 dựng hạ tầng lịch nhắc.
 */
@Injectable()
export class AttachmentCleanupService {
  private readonly logger = new Logger(AttachmentCleanupService.name);

  constructor(
    @InjectModel(CrmAttachment.name)
    private readonly attachmentModel: Model<CrmAttachmentDocument>,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
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
        .select('fileKey')
        .limit(PURGE_BATCH_SIZE)
        .lean()
        .exec();
      if (rows.length === 0) break;
      const done: typeof rows = [];
      for (const row of rows) {
        try {
          await this.storage.delete(StorageBucket.ATTACHMENTS, row.fileKey);
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
