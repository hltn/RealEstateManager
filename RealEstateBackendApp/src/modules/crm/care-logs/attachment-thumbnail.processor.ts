import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { UnrecoverableError } from 'bullmq';
import { Connection, Model, Types } from 'mongoose';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import {
  FILE_STORAGE,
  StorageBucket,
} from '../../../shared/storage/file-storage.interface';
import type { IFileStorage } from '../../../shared/storage/file-storage.interface';
import { ATTACHMENT_IMAGE_POLICY } from '../../../shared/storage/file-validation';
import {
  attachmentPrefix,
  AttachmentStatus,
  ThumbStatus,
} from './care-log.constants';
import { CareLog, CareLogDocument } from './schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentDocument,
} from './schemas/crm-attachment.schema';
import {
  createThumbnail,
  THUMBNAIL_MIME_TYPE,
  ThumbnailImageError,
} from './utils/create-thumbnail.util';

/** Số lần thử mặc định của job (khớp `DEFAULT_JOB_OPTIONS.attempts`) khi job không mang `opts.attempts`. */
const DEFAULT_ATTEMPTS = 3;

/** Dữ liệu tối thiểu của job `attachment.thumbnail` mà processor cần (tách khỏi kiểu `Job` để test không phải dựng Job). */
export interface AttachmentThumbnailJobLike {
  data: { attachmentId?: unknown };
  /** Số lần đã thử trước lần này (BullMQ: 0 ở lần đầu). */
  attemptsMade: number;
  opts?: { attempts?: number };
}

/** Kết quả một lần xử lý: `CREATED` = đã có thumbnail; `SKIPPED` = không cần/không làm được (job vẫn hoàn thành). */
export type AttachmentThumbnailOutcome = 'CREATED' | 'SKIPPED';

/**
 * Xử lý job `attachment.thumbnail` (FR-26, Architecture 5.9.1). Luồng:
 * 1. Bỏ qua (idempotent) khi cờ CRM/ảnh đính kèm tắt, kho chưa cấu hình, ảnh không còn dùng (không READY/ATTACHED,
 *    đã `purgedAt`) hoặc đã có `thumbKey`.
 * 2. Tải ảnh gốc từ kho, thu nhỏ bằng `sharp` (cạnh dài <= 320px, WebP, không metadata), tải thumbnail lên cùng
 *    bucket với khóa UUID mới dưới tiền tố của khách.
 * 3. Trong MỘT transaction: cập nhật có điều kiện `crm_attachments` (`thumbKey: null` -> khóa mới, `thumbStatus = READY`,
 *    `width`, `height`) VÀ bản chụp ảnh trong `care_logs.attachments` (mapper đọc từ bản chụp này). Không khớp điều
 *    kiện (job khác thắng trước, ảnh bị gỡ giữa chừng) thì xóa thumbnail vừa tải lên, không để file mồ côi.
 * Lỗi: ảnh không giải mã được => `FAILED` ngay + `UnrecoverableError` (retry không giúp); lỗi hạ tầng => ném lỗi để
 * BullMQ retry, lần cuối đánh dấu `FAILED`. Mỗi lần lỗi tăng `thumbAttempts`. Ảnh `FAILED` vẫn dùng được (`thumbUrl = url`).
 * Log chỉ ghi `attachmentId`, không ghi khóa file hay tên.
 */
@Injectable()
export class AttachmentThumbnailProcessor {
  private readonly logger = new Logger(AttachmentThumbnailProcessor.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CrmAttachment.name)
    private readonly attachmentModel: Model<CrmAttachmentDocument>,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async process(
    job: AttachmentThumbnailJobLike,
  ): Promise<AttachmentThumbnailOutcome> {
    const attachmentId = this.parseAttachmentId(job.data.attachmentId);
    if (
      !this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED) ||
      !this.featureFlags.isEnabled(FeatureFlag.CRM_ATTACHMENTS) ||
      !this.storage.isConfigured()
    ) {
      return 'SKIPPED';
    }
    try {
      return await this.generate(attachmentId);
    } catch (error) {
      const isPermanent = error instanceof ThumbnailImageError;
      const isLastAttempt =
        job.attemptsMade + 1 >= (job.opts?.attempts ?? DEFAULT_ATTEMPTS);
      await this.recordFailure(attachmentId, isPermanent || isLastAttempt);
      this.logger.warn(
        `Thumbnail ảnh ${String(attachmentId)} thất bại (${isPermanent ? 'ảnh không xử lý được' : 'lỗi tạm thời'}): ${(error as Error).message}`,
      );
      if (isPermanent) {
        throw new UnrecoverableError('THUMBNAIL_IMAGE_INVALID');
      }
      throw error;
    }
  }

  private parseAttachmentId(raw: unknown): Types.ObjectId {
    if (typeof raw !== 'string' || !Types.ObjectId.isValid(raw)) {
      // Job sai dữ liệu: retry không bao giờ đúng.
      throw new UnrecoverableError('THUMBNAIL_INVALID_JOB');
    }
    return new Types.ObjectId(raw);
  }

  private async generate(
    attachmentId: Types.ObjectId,
  ): Promise<AttachmentThumbnailOutcome> {
    const attachment = await this.attachmentModel
      .findOne({
        _id: attachmentId,
        status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
        purgedAt: null,
        thumbKey: null,
      })
      .select('customerId fileKey')
      .lean()
      .exec();
    if (!attachment) return 'SKIPPED';

    const original = await this.storage.download(
      StorageBucket.ATTACHMENTS,
      attachment.fileKey,
    );
    const thumbnail = await createThumbnail(original);
    const stored = await this.storage.upload({
      bucket: StorageBucket.ATTACHMENTS,
      body: thumbnail.buffer,
      mimeType: THUMBNAIL_MIME_TYPE,
      policy: ATTACHMENT_IMAGE_POLICY,
      prefix: attachmentPrefix(String(attachment.customerId)),
    });

    let isApplied = false;
    try {
      isApplied = await this.applyThumbnail(attachmentId, {
        thumbKey: stored.key,
        width: thumbnail.width,
        height: thumbnail.height,
      });
    } finally {
      // Không áp dụng được (job khác thắng, ảnh bị gỡ) hoặc ghi DB lỗi: không để thumbnail mồ côi trong kho.
      if (!isApplied) await this.discardUploaded(stored.key);
    }
    return isApplied ? 'CREATED' : 'SKIPPED';
  }

  /**
   * Cập nhật có điều kiện (`thumbKey: null`, ảnh còn dùng) ở `crm_attachments` rồi đồng bộ bản chụp trong nhật ký
   * (cùng transaction vì ghi 2 collection). Trả `false` khi không khớp điều kiện.
   */
  private applyThumbnail(
    attachmentId: Types.ObjectId,
    thumb: { thumbKey: string; width: number; height: number },
  ): Promise<boolean> {
    return withTransaction(this.connection, async (session) => {
      const result = await this.attachmentModel
        .updateOne(
          {
            _id: attachmentId,
            status: {
              $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED],
            },
            thumbKey: null,
          },
          {
            $set: {
              thumbKey: thumb.thumbKey,
              thumbStatus: ThumbStatus.READY,
              width: thumb.width,
              height: thumb.height,
            },
          },
          { session },
        )
        .exec();
      if (result.matchedCount === 0) return false;
      // Ảnh đã gắn vào nhật ký: mapper đọc `care_logs.attachments[]`, nên bản chụp cũng phải có `thumbKey`.
      await this.careLogModel
        .updateOne(
          { 'attachments.attachmentId': attachmentId },
          {
            $set: {
              'attachments.$[img].thumbKey': thumb.thumbKey,
              'attachments.$[img].width': thumb.width,
              'attachments.$[img].height': thumb.height,
            },
          },
          {
            arrayFilters: [{ 'img.attachmentId': attachmentId }],
            session,
          },
        )
        .exec();
      return true;
    });
  }

  /** Ghi nhận một lần lỗi: tăng `thumbAttempts`; `shouldMarkFailed` (lỗi xác định hoặc hết lượt) thì đặt `FAILED`. */
  private async recordFailure(
    attachmentId: Types.ObjectId,
    shouldMarkFailed: boolean,
  ): Promise<void> {
    try {
      await this.attachmentModel
        .updateOne(
          { _id: attachmentId, thumbKey: null },
          {
            $inc: { thumbAttempts: 1 },
            ...(shouldMarkFailed
              ? { $set: { thumbStatus: ThumbStatus.FAILED } }
              : {}),
          },
        )
        .exec();
    } catch (error) {
      // Ghi nhận lỗi là phụ: không che lỗi gốc của job.
      this.logger.warn(
        `Không ghi được trạng thái lỗi thumbnail ${String(attachmentId)}: ${(error as Error).message}`,
      );
    }
  }

  private async discardUploaded(key: string): Promise<void> {
    try {
      await this.storage.delete(StorageBucket.ATTACHMENTS, key);
    } catch (error) {
      this.logger.warn(
        `Không xóa được thumbnail mồ côi: ${(error as Error).message}`,
      );
    }
  }
}
