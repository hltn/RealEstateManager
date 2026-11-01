import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import {
  endOfDayUtc,
  startOfDayUtc,
} from '../../../common/utils/timezone.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { AppointmentsWriteService } from '../appointments/appointments-write.service';
import { invalidField } from '../appointments/appointment.rules';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import { RemindersWriterService } from '../reminders/reminders-writer.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/notification.constants';
import {
  AccessContext,
  CustomerAccessService,
} from '../customers/access/customer-access.service';
import {
  customerNotFound,
  resolveClientSource,
} from '../customers/customer.errors';
import { CustomerRefsService } from '../customers/customer-refs.service';
import { CustomersRepository } from '../customers/customers.repository';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { CareLogSource } from './care-log.constants';
import { CareLogLean, toCareLogResponse } from './care-log.mapper';
import {
  assertAttachmentCount,
  assertCanModifyCareLog,
  assertOccurredAtNotFuture,
  diffAttachmentIds,
} from './care-log.rules';
import {
  CareLogResponseDto,
  CreateCareLogDto,
  ListCareLogsQueryDto,
  UpdateCareLogDto,
} from './dtos/care-log.dto';
import { CareLog, CareLogDocument } from './schemas/care-log.schema';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const logNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Không tìm thấy nhật ký chăm sóc',
    HttpStatus.NOT_FOUND,
  );

/**
 * Nhật ký chăm sóc của khách (`care_logs`, tài liệu 05 mục 2.6, 04 mục 6.6). Mọi thao tác ghi chạy trong MỘT
 * transaction gồm: nhật ký + ảnh đính kèm + `customers.lastCareLogAt` + audit. Khách ngoài phạm vi (hoặc người vừa
 * bị gỡ khỏi nhóm chăm sóc) nhận 404 `CUSTOMER_NOT_FOUND` ở mọi thao tác.
 */
@Injectable()
export class CareLogsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly attachments: CareLogAttachmentsService,
    private readonly audit: CrmAuditLogService,
    private readonly featureFlags: FeatureFlagService,
    private readonly appointmentsWriter: AppointmentsWriteService,
    private readonly reminders: RemindersWriterService,
    private readonly notifications: NotificationsService,
    private readonly settings: CrmSettingsService,
  ) {}

  async list(
    jwt: JwtPayload,
    customerId: string,
    query: ListCareLogsQueryDto,
  ): Promise<{ data: CareLogResponseDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    const customer = await this.repo.findOne(ctx.scope, customerId, {
      projection: { _id: 1 },
    });
    if (!customer) throw customerNotFound();

    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = {
      customerId: oid(customerId),
      deletedAt: null,
      ...(query.authorId && { authorId: oid(query.authorId) }),
      ...(query.contactChannel && { contactChannel: query.contactChannel }),
      ...((query.from || query.to) && {
        occurredAt: {
          ...(query.from && { $gte: startOfDayUtc(query.from) }),
          ...(query.to && { $lte: endOfDayUtc(query.to) }),
        },
      }),
    };
    const [rows, total] = await Promise.all([
      this.careLogModel
        .find(filter)
        .sort({ occurredAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.careLogModel.countDocuments(filter).exec(),
    ]);
    return {
      data: await this.toResponses(rows as CareLogLean[], ctx),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async create(
    jwt: JwtPayload,
    customerId: string,
    dto: CreateCareLogDto,
    clientType?: string,
  ): Promise<CareLogResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const created = await withTransaction(this.connection, (session) =>
      this.createInSession(ctx, customerId, dto, auditSource, session),
    );
    return this.toResponse(created, ctx);
  }

  /**
   * Ghi nhật ký trong transaction của bên gọi (API ghi nhật ký, hoàn thành lịch hẹn kèm nhật ký). Cùng transaction:
   * nhật ký, ảnh, lịch hẹn tạo kèm (`nextAction.appointment`), nhắc việc, thông báo cho người cùng chăm sóc,
   * `lastCareLogAt` và audit.
   */
  async createInSession(
    ctx: AccessContext,
    customerId: string,
    dto: CreateCareLogDto,
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<CareLogLean> {
    const now = new Date();
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : now;
    assertOccurredAtNotFuture(occurredAt, now);
    const attachmentIds = (dto.attachmentIds ?? []).map(oid);
    this.assertAttachmentsAllowed(attachmentIds.length);
    const nextActionDueAt = dto.nextAction?.dueAt
      ? new Date(dto.nextAction.dueAt)
      : null;
    if (dto.nextAction?.appointment && !nextActionDueAt) {
      throw invalidField(
        'Tạo lịch hẹn kèm nhật ký cần có nextAction.dueAt (giờ hẹn)',
        'nextAction.dueAt',
      );
    }

    const customer = await this.repo.findOne(ctx.scope, customerId, {
      session,
      projection: { fullName: 1, careTeam: 1 },
    });
    if (!customer) throw customerNotFound();

    const contactResultId = dto.contactResultId
      ? oid(dto.contactResultId)
      : null;
    await this.refs.lockAndAssert({ contactResultId }, session);

    const _id = new Types.ObjectId();
    const attached = await this.attachments.attachToCareLog(
      ctx.actor,
      oid(customerId),
      _id,
      attachmentIds,
      session,
    );

    let appointmentId: Types.ObjectId | null = null;
    if (dto.nextAction?.appointment && nextActionDueAt) {
      const { appointment } = await this.appointmentsWriter.createInSession(
        ctx,
        {
          customerId: oid(customerId),
          type: dto.nextAction.appointment.type,
          startAt: nextActionDueAt,
          title: dto.nextAction.suggestion ?? '',
          location: dto.nextAction.appointment.location,
          remindBeforeMinutes: dto.nextAction.appointment.remindBeforeMinutes,
          projectId: dto.nextAction.appointment.projectId
            ? oid(dto.nextAction.appointment.projectId)
            : null,
          sourceCareLogId: _id,
        },
        auditSource,
        session,
      );
      appointmentId = appointment._id;
    }

    const doc = {
      _id,
      customerId: oid(customerId),
      authorId: ctx.actor.userId,
      authorName: ctx.actor.displayName,
      occurredAt,
      content: dto.content,
      contactChannel: dto.contactChannel,
      contactResultId,
      nextAction: dto.nextAction
        ? {
            suggestion: dto.nextAction.suggestion ?? null,
            dueAt: nextActionDueAt,
            appointmentId,
          }
        : null,
      attachments: attached,
      source: CareLogSource.MANUAL,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
    };
    const [inserted] = await this.careLogModel.create([doc], { session });

    // `lastCareLogAt` là mốc lớn nhất (nhập bù ngày cũ không làm lùi mốc). Không tăng `__v` để không làm
    // người đang sửa hồ sơ bị VERSION_CONFLICT chỉ vì có thêm một ghi chú.
    await this.repo.updateOne(
      ctx.scope,
      customerId,
      {},
      {
        $max: { lastCareLogAt: occurredAt },
        $set: { lastUpdatedAt: now, lastUpdatedBy: ctx.actor.userId },
      },
      { session },
    );

    await this.reminders.syncFollowUp(
      {
        _id,
        customerId: oid(customerId),
        authorId: ctx.actor.userId,
        dueAt: nextActionDueAt,
        appointmentId,
      },
      now,
      session,
    );
    await this.notifyCareTeam(ctx, customer, now, session);

    const changes: CrmAuditChange[] = [
      { field: 'careLog.content', from: null, to: dto.content },
      {
        field: 'careLog.contactChannel',
        from: null,
        to: dto.contactChannel,
      },
    ];
    if (dto.nextAction?.suggestion) {
      changes.push({
        field: 'careLog.nextAction.suggestion',
        from: null,
        to: dto.nextAction.suggestion,
      });
    }
    if (attached.length > 0) {
      changes.push({
        field: 'careLog.attachmentCount',
        from: 0,
        to: attached.length,
      });
    }
    await this.recordAudit(
      ctx,
      customerId,
      _id,
      CrmAuditAction.CARE_LOG_CREATED,
      changes,
      null,
      auditSource,
      session,
    );
    return inserted.toObject() as CareLogLean;
  }

  /**
   * Báo người cùng chăm sóc (trừ người ghi) có ghi chú mới. Gộp theo khách trong `careLogNotifyDebounceMinutes`:
   * khóa chống trùng gắn với (khách, khung thời gian) nên các ghi chú liên tiếp chỉ tạo MỘT thông báo cho mỗi người.
   */
  private async notifyCareTeam(
    ctx: AccessContext,
    customer: {
      _id: Types.ObjectId;
      fullName: string;
      careTeam?: Array<{ userId: Types.ObjectId }>;
    },
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const recipients = (customer.careTeam ?? []).filter(
      (member) => !member.userId.equals(ctx.actor.userId),
    );
    if (recipients.length === 0) return;
    const { careLogNotifyDebounceMinutes } = await this.settings.get();
    const windowMs = careLogNotifyDebounceMinutes * 60 * 1000;
    // 0 phút = không gộp (mỗi ghi chú một thông báo).
    const bucket = windowMs > 0 ? Math.floor(now.getTime() / windowMs) : null;
    await this.notifications.createMany(
      recipients.map((member) => ({
        userId: member.userId,
        type: NotificationType.CARE_LOG_ADDED,
        title: 'Ghi chú chăm sóc mới',
        body: `${ctx.actor.displayName} vừa ghi chú cho khách ${customer.fullName}`,
        data: {
          customerId: customer._id,
          deepLink: `/crm/customers/${String(customer._id)}`,
        },
        ...(bucket !== null && {
          dedupeKey: `CARE_LOG:${String(customer._id)}:${bucket}`,
        }),
      })),
      session,
    );
  }

  async update(
    jwt: JwtPayload,
    customerId: string,
    logId: string,
    dto: UpdateCareLogDto,
    clientType?: string,
  ): Promise<CareLogResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    if (dto.attachmentIds)
      this.assertAttachmentsAllowed(dto.attachmentIds.length);

    const { updated, removedKeys } = await withTransaction(
      this.connection,
      async (session) => {
        const customer = await this.repo.findOne(ctx.scope, customerId, {
          session,
          projection: { _id: 1 },
        });
        if (!customer) throw customerNotFound();
        const log = await this.findLog(customerId, logId, session);
        const now = new Date();
        assertCanModifyCareLog(ctx.actor, log, now);

        const set: Record<string, unknown> = {};
        const changes: CrmAuditChange[] = [];
        if (dto.content !== undefined && dto.content !== log.content) {
          set.content = dto.content;
          changes.push({
            field: 'careLog.content',
            from: log.content,
            to: dto.content,
          });
        }
        if (
          dto.contactChannel !== undefined &&
          dto.contactChannel !== log.contactChannel
        ) {
          set.contactChannel = dto.contactChannel;
          changes.push({
            field: 'careLog.contactChannel',
            from: log.contactChannel,
            to: dto.contactChannel,
          });
        }
        let occurredAtChanged = false;
        if (dto.occurredAt !== undefined) {
          const occurredAt = new Date(dto.occurredAt);
          assertOccurredAtNotFuture(occurredAt, now);
          if (occurredAt.getTime() !== log.occurredAt.getTime()) {
            set.occurredAt = occurredAt;
            occurredAtChanged = true;
            changes.push({
              field: 'careLog.occurredAt',
              from: log.occurredAt.toISOString(),
              to: occurredAt.toISOString(),
            });
          }
        }
        if (dto.contactResultId !== undefined) {
          const next = dto.contactResultId ? oid(dto.contactResultId) : null;
          if (String(next ?? '') !== String(log.contactResultId ?? '')) {
            await this.refs.lockAndAssert({ contactResultId: next }, session);
            set.contactResultId = next;
            changes.push({
              field: 'careLog.contactResult',
              from: log.contactResultId ? String(log.contactResultId) : null,
              to: next ? String(next) : null,
            });
          }
        }

        let removedKeys: string[] = [];
        if (dto.attachmentIds !== undefined) {
          const current = (log.attachments ?? []).map(
            (item) => item.attachmentId,
          );
          const { toAttach, toDetach } = diffAttachmentIds(
            current,
            dto.attachmentIds.map(oid),
          );
          assertAttachmentCount(
            current.length - toDetach.length + toAttach.length,
          );
          if (toAttach.length > 0 || toDetach.length > 0) {
            removedKeys = await this.attachments.detachFromCareLog(
              log._id,
              toDetach,
              ctx.actor.userId,
              now,
              session,
            );
            const added = await this.attachments.attachToCareLog(
              ctx.actor,
              log.customerId,
              log._id,
              toAttach,
              session,
            );
            set.attachments = [
              ...(log.attachments ?? []).filter(
                (item) => !toDetach.some((id) => id.equals(item.attachmentId)),
              ),
              ...added,
            ];
            changes.push({
              field: 'careLog.attachmentCount',
              from: current.length,
              to: (set.attachments as unknown[]).length,
            });
          }
        }

        if (changes.length === 0) return { updated: log, removedKeys };

        set.editedAt = now;
        await this.careLogModel
          .updateOne({ _id: log._id }, { $set: set }, { session })
          .exec();
        if (occurredAtChanged) {
          await this.recomputeLastCareLogAt(ctx, customerId, now, session);
        } else {
          await this.touchCustomer(ctx, customerId, now, session);
        }
        await this.recordAudit(
          ctx,
          customerId,
          log._id,
          CrmAuditAction.CARE_LOG_UPDATED,
          changes,
          null,
          auditSource,
          session,
        );
        return {
          updated: { ...log, ...set } as CareLogLean,
          removedKeys,
        };
      },
    );
    await this.attachments.purgeFiles(removedKeys);
    return this.toResponse(updated, ctx);
  }

  async remove(
    jwt: JwtPayload,
    customerId: string,
    logId: string,
    reason: string | undefined,
    clientType?: string,
  ): Promise<void> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    const removedKeys = await withTransaction(
      this.connection,
      async (session) => {
        const customer = await this.repo.findOne(ctx.scope, customerId, {
          session,
          projection: { _id: 1 },
        });
        if (!customer) throw customerNotFound();
        const log = await this.findLog(customerId, logId, session);
        const now = new Date();
        assertCanModifyCareLog(ctx.actor, log, now);

        await this.careLogModel
          .updateOne(
            { _id: log._id },
            { $set: { deletedAt: now, deletedBy: ctx.actor.userId } },
            { session },
          )
          .exec();
        const keys = await this.attachments.detachFromCareLog(
          log._id,
          'ALL',
          ctx.actor.userId,
          now,
          session,
        );
        await this.recomputeLastCareLogAt(ctx, customerId, now, session);
        await this.reminders.cancelFollowUp(log._id, now, session);
        await this.recordAudit(
          ctx,
          customerId,
          log._id,
          CrmAuditAction.CARE_LOG_DELETED,
          [],
          reason ?? null,
          auditSource,
          session,
        );
        return keys;
      },
    );
    await this.attachments.purgeFiles(removedKeys);
  }

  // --------------------------------------------------------------------------------------------

  /** Ảnh đính kèm chỉ dùng được khi cờ `FEATURE_CRM_ATTACHMENTS` bật; tối đa 5 ảnh/ghi chú. */
  private assertAttachmentsAllowed(count: number): void {
    if (count === 0) return;
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ATTACHMENTS)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Tính năng ảnh đính kèm đang tắt',
        HttpStatus.BAD_REQUEST,
        { field: 'attachmentIds' },
      );
    }
    assertAttachmentCount(count);
  }

  private async findLog(
    customerId: string,
    logId: string,
    session: ClientSession,
  ): Promise<CareLogLean> {
    const log = await this.careLogModel
      .findOne({
        _id: oid(logId),
        customerId: oid(customerId),
        deletedAt: null,
      })
      .session(session)
      .lean()
      .exec();
    if (!log) throw logNotFound();
    return log as CareLogLean;
  }

  /** Ghi nhận khách vừa được cập nhật (không đổi `__v`). */
  private async touchCustomer(
    ctx: AccessContext,
    customerId: string,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    await this.repo.updateOne(
      ctx.scope,
      customerId,
      {},
      { $set: { lastUpdatedAt: now, lastUpdatedBy: ctx.actor.userId } },
      { session },
    );
  }

  /** `lastCareLogAt` = `occurredAt` lớn nhất của các nhật ký chưa xóa (null nếu không còn nhật ký nào). */
  private async recomputeLastCareLogAt(
    ctx: AccessContext,
    customerId: string,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const latest = await this.careLogModel
      .findOne({ customerId: oid(customerId), deletedAt: null })
      .sort({ occurredAt: -1 })
      .select('occurredAt')
      .session(session)
      .lean()
      .exec();
    await this.repo.updateOne(
      ctx.scope,
      customerId,
      {},
      {
        $set: {
          lastCareLogAt: latest?.occurredAt ?? null,
          lastUpdatedAt: now,
          lastUpdatedBy: ctx.actor.userId,
        },
      },
      { session },
    );
  }

  private recordAudit(
    ctx: AccessContext,
    customerId: string,
    careLogId: Types.ObjectId,
    action: CrmAuditAction,
    changes: CrmAuditChange[],
    reason: string | null,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<void> {
    return this.audit.record(
      {
        entityType: CrmAuditEntityType.CARE_LOG,
        entityId: careLogId,
        customerId,
        action,
        actor: { sub: String(ctx.actor.userId) },
        changes,
        reason,
        source,
      },
      session,
    );
  }

  async toResponse(
    log: CareLogLean,
    ctx: AccessContext,
  ): Promise<CareLogResponseDto> {
    const [response] = await this.toResponses([log], ctx);
    return response;
  }

  /** Dựng response theo lô: tên người viết/kết quả liên hệ một lần `$in`, ký URL ảnh song song. */
  private async toResponses(
    logs: CareLogLean[],
    ctx: AccessContext,
  ): Promise<CareLogResponseDto[]> {
    const [maps, urls] = await Promise.all([
      this.refs.resolve({
        userIds: logs.map((log) => log.authorId),
        contactResultIds: logs.map((log) => log.contactResultId),
      }),
      this.attachments.signUrls(logs),
    ]);
    const now = new Date();
    return logs.map((log) =>
      toCareLogResponse(log, ctx.actor, now, maps, urls),
    );
  }
}
