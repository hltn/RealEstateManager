import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  FILE_STORAGE,
  StorageBucket,
} from '../../../shared/storage/file-storage.interface';
import type { IFileStorage } from '../../../shared/storage/file-storage.interface';
import {
  assertFileAllowed,
  ATTACHMENT_IMAGE_POLICY,
  normalizeMime,
} from '../../../shared/storage/file-validation';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmActor } from '../common/access/crm-actor';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CustomerAccessService } from '../customers/access/customer-access.service';
import {
  customerNotFound,
  resolveClientSource,
} from '../customers/customer.errors';
import { CustomersRepository } from '../customers/customers.repository';
import {
  ATTACHMENT_ORIGINAL_NAME_MAX_LENGTH,
  attachmentPrefix,
  AttachmentKind,
  AttachmentStatus,
  MAX_UNATTACHED_PER_UPLOADER,
} from './care-log.constants';
import { assertCanModifyCareLog } from './care-log.rules';
import type { AttachmentUrls, CareLogLean } from './care-log.mapper';
import { AttachmentUploadResponseDto } from './dtos/care-log.dto';
import { CareLog, CareLogDocument } from './schemas/care-log.schema';
import type { CareLogAttachment } from './schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentDocument,
} from './schemas/crm-attachment.schema';
import {
  InvalidImageError,
  stripImageMetadata,
} from './utils/strip-image-metadata.util';

/** File đã đọc xong từ request multipart. */
export interface UploadedImage {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

const resourceNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Không tìm thấy ảnh đính kèm',
    HttpStatus.NOT_FOUND,
  );

/** Tên file gốc chỉ để hiển thị: bỏ đường dẫn, ký tự điều khiển, cắt độ dài. */
const sanitizeOriginalName = (name: string): string =>
  name
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, ATTACHMENT_ORIGINAL_NAME_MAX_LENGTH);

/**
 * Ảnh đính kèm nhật ký (`crm_attachments`, tài liệu 04 mục 6.6): upload (kiểm loại + dung lượng + magic bytes,
 * bỏ Exif/GPS, đổi tên UUID, lưu MinIO/S3 bucket `crm-attachments`), gắn vào ĐÚNG ghi chú của người tải lên,
 * gỡ, ký URL tải 15 phút. File chỉ bị xóa khỏi kho SAU khi transaction commit (không gọi mạng trong transaction);
 * `AttachmentCleanupService` dọn phần còn sót.
 */
@Injectable()
export class CareLogAttachmentsService {
  private readonly logger = new Logger(CareLogAttachmentsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CrmAttachment.name)
    private readonly attachmentModel: Model<CrmAttachmentDocument>,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly rateLimit: CrmRateLimitService,
    private readonly audit: CrmAuditLogService,
  ) {}

  /**
   * `readFile` đọc file từ request CHẬM (sau khi đã qua giới hạn tốc độ + kiểm phạm vi khách), để người ngoài phạm vi
   * luôn nhận 404 và không tốn băng thông/bộ nhớ đọc cả file.
   */
  async upload(
    jwt: JwtPayload,
    customerId: string,
    readFile: () => Promise<UploadedImage>,
    clientType?: string,
  ): Promise<AttachmentUploadResponseDto> {
    await this.rateLimit.consume(jwt.sub, 'ATTACHMENT_UPLOAD');
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const customer = await this.repo.findOne(ctx.scope, customerId, {
      projection: { _id: 1 },
    });
    if (!customer) throw customerNotFound();

    if (!this.storage.isConfigured()) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Kho lưu trữ ảnh chưa được cấu hình',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const customerObjectId = new Types.ObjectId(customerId);
    const unattached = await this.attachmentModel
      .countDocuments({
        customerId: customerObjectId,
        uploaderId: ctx.actor.userId,
        status: AttachmentStatus.READY,
        careLogId: null,
      })
      .exec();
    if (unattached >= MAX_UNATTACHED_PER_UPLOADER) {
      throw new BusinessException(
        ErrorCode.ATTACHMENT_LIMIT_EXCEEDED,
        'Bạn đang có quá nhiều ảnh chưa gắn vào ghi chú, hãy lưu ghi chú hoặc gỡ bớt ảnh',
        HttpStatus.BAD_REQUEST,
        { max: MAX_UNATTACHED_PER_UPLOADER },
      );
    }

    const file = await readFile();
    // Kiểm loại/dung lượng/magic bytes TRƯỚC khi đụng vào nội dung ảnh hay kho lưu trữ.
    const mimeType = normalizeMime(file.mimeType);
    assertFileAllowed(ATTACHMENT_IMAGE_POLICY, {
      mimeType,
      size: file.buffer.length,
      buffer: file.buffer,
    });
    let clean: Buffer;
    try {
      clean = stripImageMetadata(file.buffer, mimeType);
    } catch (error) {
      if (error instanceof InvalidImageError) {
        throw new BusinessException(
          ErrorCode.ATTACHMENT_TYPE_INVALID,
          'Ảnh bị hỏng hoặc không đúng định dạng',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      throw error;
    }
    const stored = await this.storage.upload({
      bucket: StorageBucket.ATTACHMENTS,
      body: clean,
      mimeType,
      policy: ATTACHMENT_IMAGE_POLICY,
      prefix: attachmentPrefix(customerId),
    });

    try {
      return await withTransaction(this.connection, async (session) => {
        const [created] = await this.attachmentModel.create(
          [
            {
              customerId: customerObjectId,
              uploaderId: ctx.actor.userId,
              kind: AttachmentKind.CARE_LOG_IMAGE,
              fileKey: stored.key,
              originalName: sanitizeOriginalName(file.originalName),
              mimeType: stored.mimeType,
              size: stored.size,
              status: AttachmentStatus.READY,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.ATTACHMENT,
            entityId: created._id,
            customerId: customerObjectId,
            action: CrmAuditAction.ATTACHMENT_UPLOADED,
            actor: { sub: String(ctx.actor.userId) },
            changes: [
              {
                field: 'attachment',
                from: null,
                to: { mimeType: stored.mimeType, size: stored.size },
              },
            ],
            source: auditSource,
          },
          session,
        );
        return { id: String(created._id), status: AttachmentStatus.READY };
      });
    } catch (error) {
      // Ghi DB lỗi thì không để file mồ côi nằm lại kho.
      await this.purgeFiles([stored.key]);
      throw error;
    }
  }

  /**
   * Gỡ một ảnh (04 mục 4.2): chưa gắn => người tải lên hoặc Quản trị/Quản lý (trong phạm vi); đã gắn => tác giả
   * nhật ký trong 24 giờ hoặc Quản trị/Quản lý. Ảnh đã gắn cũng bị rút khỏi nhật ký.
   */
  async remove(
    jwt: JwtPayload,
    customerId: string,
    attachmentId: string,
    clientType?: string,
  ): Promise<void> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const customerObjectId = new Types.ObjectId(customerId);

    const fileKey = await withTransaction(this.connection, async (session) => {
      const customer = await this.repo.findOne(ctx.scope, customerId, {
        session,
        projection: { _id: 1 },
      });
      if (!customer) throw customerNotFound();

      const attachment = await this.attachmentModel
        .findOne({
          _id: new Types.ObjectId(attachmentId),
          customerId: customerObjectId,
          status: { $in: [AttachmentStatus.READY, AttachmentStatus.ATTACHED] },
        })
        .session(session)
        .lean()
        .exec();
      if (!attachment) throw resourceNotFound();

      const now = new Date();
      const isPrivileged =
        ctx.actor.role === UserRole.ADMIN ||
        ctx.actor.role === UserRole.MANAGER;
      if (attachment.status === AttachmentStatus.ATTACHED) {
        const log = await this.careLogModel
          .findOne({ _id: attachment.careLogId, deletedAt: null })
          .session(session)
          .lean()
          .exec();
        if (!log) throw resourceNotFound();
        assertCanModifyCareLog(ctx.actor, log, now);
        await this.careLogModel
          .updateOne(
            { _id: log._id },
            {
              $pull: { attachments: { attachmentId: attachment._id } },
              $set: { editedAt: now },
            },
            { session },
          )
          .exec();
      } else if (
        !isPrivileged &&
        !attachment.uploaderId.equals(ctx.actor.userId)
      ) {
        throw resourceNotFound();
      }

      await this.attachmentModel
        .updateOne(
          { _id: attachment._id },
          {
            $set: {
              status: AttachmentStatus.REMOVED,
              removedAt: now,
              removedBy: ctx.actor.userId,
            },
          },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.ATTACHMENT,
          entityId: attachment._id,
          customerId: customerObjectId,
          action: CrmAuditAction.ATTACHMENT_REMOVED,
          actor: { sub: String(ctx.actor.userId) },
          source: auditSource,
        },
        session,
      );
      return attachment.fileKey;
    });
    await this.purgeFiles([fileKey]);
  }

  /**
   * Gắn ảnh vào nhật ký trong transaction: chỉ nhận ảnh READY, chưa gắn nơi khác, đúng khách và do CHÍNH người
   * ghi tải lên. Cập nhật có điều kiện (atomic) nên hai nhật ký không thể cùng nhận một ảnh.
   * Trả bản chụp ảnh theo đúng thứ tự `ids`.
   */
  async attachToCareLog(
    actor: CrmActor,
    customerId: Types.ObjectId,
    careLogId: Types.ObjectId,
    ids: Types.ObjectId[],
    session: ClientSession,
  ): Promise<CareLogAttachment[]> {
    if (ids.length === 0) return [];
    const result = await this.attachmentModel
      .updateMany(
        {
          _id: { $in: ids },
          customerId,
          uploaderId: actor.userId,
          kind: AttachmentKind.CARE_LOG_IMAGE,
          status: AttachmentStatus.READY,
          careLogId: null,
        },
        { $set: { status: AttachmentStatus.ATTACHED, careLogId } },
        { session },
      )
      .exec();
    if (result.matchedCount !== ids.length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Có ảnh không hợp lệ: không tồn tại, không phải của bạn, thuộc khách khác hoặc đã gắn vào ghi chú khác',
        HttpStatus.BAD_REQUEST,
        { field: 'attachmentIds' },
      );
    }
    const rows = await this.attachmentModel
      .find({ _id: { $in: ids } })
      .session(session)
      .lean()
      .exec();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return ids.map((id) => {
      const row = byId.get(String(id))!;
      return {
        attachmentId: row._id,
        fileKey: row.fileKey,
        thumbKey: row.thumbKey ?? null,
        mimeType: row.mimeType,
        size: row.size,
        width: row.width ?? null,
        height: row.height ?? null,
      };
    });
  }

  /** Đánh dấu ảnh đã gắn là REMOVED (gỡ khỏi nhật ký); trả `fileKey` để xóa file SAU khi commit. */
  async detachFromCareLog(
    careLogId: Types.ObjectId,
    ids: Types.ObjectId[] | 'ALL',
    actorId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<string[]> {
    const filter = {
      careLogId,
      status: AttachmentStatus.ATTACHED,
      ...(ids === 'ALL' ? {} : { _id: { $in: ids } }),
    };
    const rows = await this.attachmentModel
      .find(filter)
      .select('fileKey')
      .session(session)
      .lean()
      .exec();
    if (rows.length === 0) return [];
    await this.attachmentModel
      .updateMany(
        { _id: { $in: rows.map((row) => row._id) } },
        {
          $set: {
            status: AttachmentStatus.REMOVED,
            removedAt: now,
            removedBy: actorId,
          },
        },
        { session },
      )
      .exec();
    return rows.map((row) => row.fileKey);
  }

  /** Ký URL tải (15 phút) cho mọi ảnh của các nhật ký, trả theo `attachmentId`. */
  async signUrls(logs: CareLogLean[]): Promise<AttachmentUrls> {
    const attachments = logs.flatMap((log) => log.attachments ?? []);
    const entries = await Promise.all(
      attachments.map(async (attachment) => {
        const url = await this.storage.getPresignedDownloadUrl(
          StorageBucket.ATTACHMENTS,
          attachment.fileKey,
        );
        return [String(attachment.attachmentId), url] as [string, string];
      }),
    );
    return new Map(entries);
  }

  /**
   * Xóa file khỏi kho rồi ghi `purgedAt`. "Best-effort": lỗi mạng chỉ ghi cảnh báo, `AttachmentCleanupService` sẽ
   * thử lại lần sau nên không làm hỏng thao tác của người dùng.
   */
  async purgeFiles(keys: string[]): Promise<void> {
    const purged: string[] = [];
    for (const key of keys) {
      try {
        await this.storage.delete(StorageBucket.ATTACHMENTS, key);
        purged.push(key);
      } catch (error) {
        this.logger.warn(
          `Xóa file đính kèm thất bại, sẽ được dọn lại sau: ${(error as Error).message}`,
        );
      }
    }
    if (purged.length === 0) return;
    await this.attachmentModel
      .updateMany(
        { fileKey: { $in: purged } },
        { $set: { purgedAt: new Date() } },
      )
      .exec();
  }
}
