import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import {
  customerNotFound,
  resolveClientSource,
  versionConflict,
} from './customer.errors';
import { CustomerRefsService } from './customer-refs.service';
import { CustomersRepository } from './customers.repository';
import { ChangeStatusDto } from './dtos/customer-request.dto';
import { ChangeStatusResponseDto } from './dtos/customer-response.dto';

/**
 * Đổi tình trạng khách (`PATCH /crm/customers/:id/status`, tài liệu 04 mục 6.2): khách tự chuyển sang danh sách
 * của tình trạng mới (không xóa/chuyển dữ liệu). Khóa lạc quan theo `version`; audit `STATUS_CHANGED` cùng transaction.
 * Dùng lại cho "Hoàn tác" bằng cách đặt lại `previousStatusId`.
 */
@Injectable()
export class CustomerStatusChangeService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async change(
    jwt: JwtPayload,
    id: string,
    dto: ChangeStatusDto,
    clientType?: string,
  ): Promise<ChangeStatusResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const targetId = new Types.ObjectId(dto.statusId);

    return withTransaction(this.connection, (session) =>
      this.applyChange(
        ctx,
        id,
        targetId,
        { version: dto.version, reason: dto.reason },
        auditSource,
        session,
      ),
    );
  }

  /**
   * Đổi tình trạng trong một transaction có sẵn (dùng chung cho API đơn lẻ và thao tác hàng loạt).
   * `version` vắng mặt (hàng loạt) thì không kiểm khóa lạc quan.
   */
  async applyChange(
    ctx: AccessContext,
    id: string,
    targetId: Types.ObjectId,
    options: { version?: number; reason?: string },
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<ChangeStatusResponseDto> {
    const { version, reason } = options;
    const before = await this.repo.findOne(ctx.scope, id, {
      session,
      projection: { statusId: 1, lastUpdatedAt: 1, __v: 1 },
    });
    if (!before) throw customerNotFound();
    if (version !== undefined && before.__v !== version) {
      throw versionConflict(before.__v);
    }

    // Đặt lại đúng tình trạng hiện tại là no-op (không ghi, không audit, không tăng version).
    if (before.statusId.equals(targetId)) {
      const maps = await this.refs.resolve({ statusIds: [targetId] });
      return {
        status: maps.statuses.get(String(targetId))!,
        previousStatusId: String(before.statusId),
        version: before.__v,
        lastUpdatedAt: before.lastUpdatedAt.toISOString(),
      };
    }

    await this.refs.lockAndAssert({ statusId: targetId }, session);
    const now = new Date();
    const matched = await this.repo.updateOne(
      ctx.scope,
      id,
      version === undefined ? {} : { __v: version },
      {
        $set: {
          statusId: targetId,
          statusChangedAt: now,
          lastUpdatedAt: now,
          lastUpdatedBy: ctx.actor.userId,
        },
        $inc: { __v: 1 },
      },
      { session },
    );
    if (!matched) {
      const current = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { __v: 1 },
      });
      if (!current) throw customerNotFound();
      throw versionConflict(current.__v);
    }

    const maps = await this.refs.resolve({
      statusIds: [before.statusId, targetId],
    });
    const fromStatus = maps.statuses.get(String(before.statusId));
    const toStatus = maps.statuses.get(String(targetId))!;
    await this.audit.record(
      {
        entityType: CrmAuditEntityType.CUSTOMER,
        entityId: id,
        customerId: id,
        action: CrmAuditAction.STATUS_CHANGED,
        actor: { sub: String(ctx.actor.userId) },
        changes: [
          {
            field: 'status',
            from: fromStatus
              ? {
                  id: fromStatus.id,
                  label: fromStatus.label,
                  listGroup: fromStatus.listGroup,
                }
              : null,
            to: {
              id: toStatus.id,
              label: toStatus.label,
              listGroup: toStatus.listGroup,
            },
          },
        ],
        reason: reason ?? null,
        source: auditSource,
      },
      session,
    );
    return {
      status: toStatus,
      previousStatusId: String(before.statusId),
      version: before.__v + 1,
      lastUpdatedAt: now.toISOString(),
    };
  }
}
