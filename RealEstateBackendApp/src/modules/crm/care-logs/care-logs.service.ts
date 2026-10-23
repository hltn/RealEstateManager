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
    const now = new Date();
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : now;
    assertOccurredAtNotFuture(occurredAt, now);
    const attachmentIds = (dto.attachmentIds ?? []).map(oid);
    this.assertAttachmentsAllowed(attachmentIds.length);

    const created = await withTransaction(this.connection, async (session) => {
      const customer = await this.repo.findOne(ctx.scope, customerId, {
        session,
        projection: { _id: 1 },
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
              dueAt: dto.nextAction.dueAt
                ? new Date(dto.nextAction.dueAt)
                : null,
              appointmentId: null,
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
    });
    return this.toResponse(created, ctx);
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

  private async toResponse(
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
