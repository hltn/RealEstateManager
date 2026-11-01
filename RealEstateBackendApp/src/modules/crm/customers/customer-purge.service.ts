import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
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
  Notification,
  NotificationDocument,
} from '../../notifications/schemas/notification.schema';
import {
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import {
  CrmAuditAction,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CareLog, CareLogDocument } from '../care-logs/schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentDocument,
} from '../care-logs/schemas/crm-attachment.schema';
import {
  CareTeamRequest,
  CareTeamRequestDocument,
} from '../care-teams/schemas/care-team-request.schema';
import {
  Reminder,
  ReminderDocument,
} from '../reminders/schemas/reminder.schema';
import { Tag, TagDocument } from '../tags/schemas/tag.schema';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import {
  customerNotDeleted,
  customerNotFound,
  customerPurgeInProgress,
  insufficientRole,
  resolveClientSource,
} from './customer.errors';
import { CustomersRepository } from './customers.repository';
import {
  PurgeCustomerResponseDto,
  PurgedCountsDto,
} from './dtos/customer-response.dto';
import { Customer, CustomerDocument } from './schemas/customer.schema';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Số file xóa đồng thời ở kho lưu trữ khi xóa vĩnh viễn (giới hạn để không dồn dập vào MinIO). */
export const PURGE_FILE_CONCURRENCY = 6;

/** Hai lần đặt cờ `purgingAt` cách nhau ít hơn khoảng này coi là xóa vĩnh viễn ĐỒNG THỜI (409); xóa file lặp lại vốn idempotent nên quá hạn vẫn an toàn. */
export const PURGE_CLAIM_GUARD_MS = 15_000;

/** Một ảnh đính kèm cần xóa file khỏi kho lưu trữ. */
interface StoredAttachment {
  _id: Types.ObjectId;
  fileKey: string;
  thumbKey: string | null;
}

/**
 * Xóa VĨNH VIỄN khách đã xóa mềm (tài liệu 09 mục 7.3) — chỉ ADMIN, KHÔNG hoàn tác.
 *
 * Thứ tự an toàn (không để lại dữ liệu mồ côi vô hình):
 * 1. Đặt cờ `purgingAt` nguyên tử (chỉ khi khách tồn tại, ĐÃ xóa mềm, chưa có lần xóa vĩnh viễn nào đang chạy). Từ đây
 *    khôi phục/ẩn danh hóa bị chặn 409 `CUSTOMER_PURGE_IN_PROGRESS` nên không ai khôi phục được khách đã mất file.
 *    Chưa xóa mềm => 409 `CUSTOMER_NOT_DELETED`, không đụng dữ liệu nào.
 * 2. Xóa file MinIO TRƯỚC, ngoài transaction, dừng ngay ở lỗi đầu tiên. Lỗi bất kỳ => 503, CHƯA xóa dòng DB nào, cờ vẫn
 *    còn (khách ở trạng thái "đang xóa dở", chỉ thoát bằng bấm Xóa vĩnh viễn lại: xóa object idempotent, file đã xóa
 *    được ghi `purgedAt` nên lần sau bỏ qua). Nhờ vậy không bao giờ có file mồ côi mà DB không còn dấu vết để dọn.
 * 3. Một transaction xóa nhật ký, ảnh, lịch hẹn, yêu cầu nhóm chăm sóc, nhắc, thông báo, audit cũ và chính khách, rồi ghi
 *    đúng MỘT dòng `CUSTOMER_PURGED` không PII (chỉ số lượng). SĐT được giải phóng vì `phone` nằm trên bản ghi khách
 *    (unique index) và bản ghi này bị xóa.
 * Ẩn danh hóa (`CustomerLifecycleService.anonymize`) giữ nguyên, không liên quan.
 */
@Injectable()
export class CustomerPurgeService {
  private readonly logger = new Logger(CustomerPurgeService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    @InjectModel(CrmAttachment.name)
    private readonly attachmentModel: Model<CrmAttachmentDocument>,
    @InjectModel(CareTeamRequest.name)
    private readonly requestModel: Model<CareTeamRequestDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Reminder.name)
    private readonly reminderModel: Model<ReminderDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async purge(
    jwt: JwtPayload,
    id: string,
    clientType?: string,
  ): Promise<PurgeCustomerResponseDto> {
    const ctx = await this.access.resolve(jwt);
    // Phòng thủ chiều sâu: `@AdminOnly()` đã chặn ở controller, service vẫn tự kiểm lại role trong DB.
    if (ctx.actor.role !== UserRole.ADMIN) throw insufficientRole();
    const { auditSource } = resolveClientSource(clientType);
    const customerId = oid(id);

    // Đặt cờ `purgingAt` NGUYÊN TỬ trước khi đụng tới file: từ đây khôi phục/ẩn danh hóa bị chặn (409).
    const claimedAt = await this.claim(ctx, customerId);
    try {
      const purged = await this.removeFilesThenPurgeRows(
        ctx,
        customerId,
        auditSource,
      );
      return { customerId: id, purged };
    } catch (error) {
      await this.releaseClaim(customerId, claimedAt);
      throw error;
    }
  }

  /**
   * Đặt cờ `purgingAt` bằng MỘT `updateOne` có điều kiện `{_id, deletedAt != null, purgingAt == null HOẶC đã quá
   * `PURGE_CLAIM_GUARD_MS`}`. Không khớp => phân loại: không có (404), chưa xóa mềm (409 `CUSTOMER_NOT_DELETED`), hoặc
   * một lần xóa vĩnh viễn khác vừa đặt cờ (409 `CUSTOMER_PURGE_IN_PROGRESS`).
   * Cờ KHÔNG hết hạn: khách ở trạng thái "đang xóa dở" chỉ thoát bằng xóa vĩnh viễn xong. `PURGE_CLAIM_GUARD_MS` chỉ để
   * chặn hai lần xóa chạy ĐỒNG THỜI (bấm đúp, hai Admin); lần lỗi giải phóng ngay (`releaseClaim`) nên thử lại liền được.
   */
  private async claim(
    ctx: AccessContext,
    customerId: Types.ObjectId,
  ): Promise<Date> {
    const now = new Date();
    const matched = await withTransaction(this.connection, (session) =>
      this.repo.updateOne(
        ctx.scope,
        customerId,
        {
          $or: [
            { purgingAt: null },
            {
              purgingAt: {
                $lte: new Date(now.getTime() - PURGE_CLAIM_GUARD_MS),
              },
            },
          ],
        },
        { $set: { purgingAt: now } },
        { session, deleted: 'only' },
      ),
    );
    if (matched) return now;
    const current = await this.repo.findOne(ctx.scope, customerId, {
      deleted: 'any',
      projection: { deletedAt: 1 },
    });
    if (!current) throw customerNotFound();
    if (!current.deletedAt) throw customerNotDeleted();
    throw customerPurgeInProgress();
  }

  /**
   * Lần xóa lỗi: lùi `purgingAt` về quá `PURGE_CLAIM_GUARD_MS` để thử lại NGAY được, nhưng vẫn khác null (khách vẫn ở
   * trạng thái "đang xóa dở", không khôi phục được). Chỉ ghi khi cờ vẫn đúng là của lần này; lỗi ở bước này chỉ ghi log
   * (người dùng thử lại sau vài giây là được).
   */
  private async releaseClaim(
    customerId: Types.ObjectId,
    claimedAt: Date,
  ): Promise<void> {
    try {
      await this.customerModel
        .updateOne(
          { _id: customerId, purgingAt: claimedAt },
          {
            $set: {
              purgingAt: new Date(claimedAt.getTime() - PURGE_CLAIM_GUARD_MS),
            },
          },
          { timestamps: false },
        )
        .exec();
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'CUSTOMER_PURGE_RELEASE_FAILED',
          customerId: String(customerId),
          error: (error as Error).message,
        }),
      );
    }
  }

  private async removeFilesThenPurgeRows(
    ctx: AccessContext,
    customerId: Types.ObjectId,
    auditSource: CrmAuditSource,
  ): Promise<PurgedCountsDto> {
    const id = String(customerId);
    const files = await this.removeStoredFiles(customerId);

    return withTransaction(this.connection, async (session) => {
      // Kiểm lại TRONG transaction: khách có thể vừa bị khôi phục/xóa vĩnh viễn bởi Admin khác.
      const current = await this.repo.findOne(ctx.scope, customerId, {
        session,
        deleted: 'any',
        projection: { deletedAt: 1, tagIds: 1 },
      });
      if (!current) throw customerNotFound();
      if (!current.deletedAt) throw customerNotDeleted();

      const deleteMany = async <T>(
        model: Model<T>,
        filter: Record<string, unknown>,
      ): Promise<number> =>
        (await model.deleteMany(filter, { session }).exec()).deletedCount;

      // Thẻ gắn cho khách được tính vào `tags.usageCount` kể cả khi khách xóa mềm: trả lại khi khách biến mất.
      if ((current.tagIds ?? []).length > 0) {
        await this.tagModel
          .updateMany(
            { _id: { $in: current.tagIds } },
            { $inc: { usageCount: -1 } },
            { session, timestamps: false },
          )
          .exec();
      }
      const counts: PurgedCountsDto = {
        careLogs: await deleteMany(this.careLogModel, { customerId }),
        attachments: await deleteMany(this.attachmentModel, { customerId }),
        files,
        appointments: await deleteMany(this.appointmentModel, { customerId }),
        careTeamRequests: await deleteMany(this.requestModel, { customerId }),
        reminders: await deleteMany(this.reminderModel, { customerId }),
        notifications: await deleteMany(this.notificationModel, {
          'data.customerId': customerId,
        }),
        // Audit cũ chứa họ tên/SĐT/email trong `changes` và lý do tự do => xóa hết, chỉ giữ một dòng sạch bên dưới.
        auditLogs: (
          await this.connection.collection('crm_audit_logs').deleteMany(
            {
              $or: [
                { customerId },
                {
                  entityType: CrmAuditEntityType.CUSTOMER,
                  entityId: customerId,
                },
              ],
            },
            { session },
          )
        ).deletedCount,
      };
      await deleteMany(this.customerModel, { _id: customerId });
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: customerId,
          customerId,
          action: CrmAuditAction.CUSTOMER_PURGED,
          actor: { sub: String(ctx.actor.userId) },
          // Chỉ số lượng: không SĐT, tên, email; không nhận lý do tự do (có thể chứa PII).
          changes: [{ field: 'purged', from: null, to: { ...counts } }],
          source: auditSource,
        },
        session,
      );
      return counts;
    }).catch((error: Error) => {
      // File đã xóa nhưng DB chưa: ghi log có cấu trúc để truy vết (không PII); thử lại được vì xóa file idempotent.
      this.logger.error(
        JSON.stringify({
          event: 'CUSTOMER_PURGE_FAILED',
          step: 'DB_TRANSACTION',
          customerId: id,
          filesDeleted: files,
          error: error.message,
        }),
      );
      throw error;
    });
  }

  /**
   * Xóa file MinIO của MỌI ảnh chưa `purgedAt` của khách (kể cả ảnh REMOVED mà job dọn chưa xóa file). Trả số file đã xóa.
   * - Song song có giới hạn (`PURGE_FILE_CONCURRENCY` worker, mỗi ảnh xóa file rồi thumbnail tuần tự) để khách nhiều ảnh
   *   không chờ từng file một.
   * - DỪNG NGAY khi gặp lỗi đầu tiên: worker nào thấy cờ dừng thì không nhận ảnh mới (kho treo mạng thì không phải chờ
   *   timeout × số ảnh); chỉ các ảnh đang xóa dở lúc đó chạy nốt.
   * - Ảnh nào xong thì ghi `purgedAt` ngay (kể cả khi có ảnh khác lỗi) để lần thử lại không làm lại.
   * Lỗi => 503 và chưa xóa gì trong DB.
   */
  private async removeStoredFiles(customerId: Types.ObjectId): Promise<number> {
    const rows: StoredAttachment[] = await this.attachmentModel
      .find({ customerId, purgedAt: null })
      .select('fileKey thumbKey')
      .lean()
      .exec();
    if (rows.length === 0) return 0;
    if (!this.storage.isConfigured()) {
      throw this.storageUnavailable('Kho lưu trữ ảnh chưa được cấu hình');
    }

    let files = 0;
    let next = 0;
    const state: { failure: { fileKey: string; error: Error } | null } = {
      failure: null,
    };
    const done: Types.ObjectId[] = [];
    const worker = async (): Promise<void> => {
      while (state.failure === null && next < rows.length) {
        const row = rows[next++];
        try {
          for (const key of [row.fileKey, row.thumbKey]) {
            if (!key) continue;
            await this.storage.delete(StorageBucket.ATTACHMENTS, key);
            files += 1;
          }
          done.push(row._id);
        } catch (error) {
          state.failure ??= { fileKey: row.fileKey, error: error as Error };
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PURGE_FILE_CONCURRENCY, rows.length) },
        () => worker(),
      ),
    );

    if (done.length > 0) {
      await this.attachmentModel
        .updateMany(
          { _id: { $in: done } },
          { $set: { purgedAt: new Date() } },
          { timestamps: false },
        )
        .exec();
    }
    const { failure } = state;
    if (failure !== null) {
      this.logger.error(
        JSON.stringify({
          event: 'CUSTOMER_PURGE_FAILED',
          step: 'DELETE_STORAGE_FILES',
          customerId: String(customerId),
          filesDeleted: files,
          attachmentsDone: done.length,
          attachmentsTotal: rows.length,
          failedFileKey: failure.fileKey,
          error: failure.error.message,
        }),
      );
      throw this.storageUnavailable(
        'Không xóa được file ảnh khỏi kho lưu trữ; chưa xóa dữ liệu nào của khách, vui lòng thử lại',
        { filesDeleted: files },
      );
    }
    return files;
  }

  private storageUnavailable(
    message: string,
    details?: Record<string, unknown>,
  ): BusinessException {
    return new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      message,
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
}
