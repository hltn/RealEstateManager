import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRefDto } from '../../../common/dto/ref.dto';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { UserRole } from '../../../common/enums/user-role.enum';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import {
  endOfDayUtc,
  startOfDayUtc,
} from '../../../common/utils/timezone.util';
import { CrmAuditChange } from '../audit-logs/crm-audit.constants';
import {
  CrmAuditLog,
  CrmAuditLogDocument,
} from '../audit-logs/schemas/crm-audit-log.schema';
import { CustomerAccessService } from './access/customer-access.service';
import { isAdminOrManager } from './access/customer-scope';
import {
  HIDDEN_HISTORY_ACTIONS,
  RESTRICTED_HISTORY_ACTIONS,
} from './customer.constants';
import { customerNotFound } from './customer.errors';
import { CustomersRepository } from './customers.repository';
import {
  ListAuditLogsQueryDto,
  ListHistoriesQueryDto,
} from './dtos/customer-query.dto';

export class HistoryEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() action: string;
  @ApiProperty({ type: UserRefDto }) actor: UserRefDto;
  @ApiProperty() actorRole: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Giá trị trường cũ -> mới; CCCD luôn được che',
  })
  changes: CrmAuditChange[];
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty() source: string;
  @ApiProperty() createdAt: string;
}

export class AuditLogEntryDto extends HistoryEntryDto {
  @ApiProperty() entityType: string;
  @ApiProperty() entityId: string;
  @ApiProperty({ nullable: true, type: String }) customerId: string | null;
  @ApiProperty() requestId: string;
  @ApiProperty({ nullable: true, type: String }) ip: string | null;
}

type AuditRow = CrmAuditLog & { _id: Types.ObjectId };

const toHistoryEntry = (row: AuditRow): HistoryEntryDto => ({
  id: String(row._id),
  action: row.action,
  actor: { id: String(row.actorId), displayName: row.actorName },
  actorRole: row.actorRole,
  changes: row.changes ?? [],
  reason: row.reason ?? null,
  source: row.source,
  createdAt: row.createdAt.toISOString(),
});

const dateRange = (from?: string, to?: string) =>
  from || to
    ? {
        createdAt: {
          ...(from && { $gte: startOfDayUtc(from) }),
          ...(to && { $lte: endOfDayUtc(to) }),
        },
      }
    : {};

/**
 * Lịch sử thay đổi của khách (`GET /crm/customers/:id/histories`) và audit toàn CRM (`/crm/audit-logs`, Quản trị).
 *
 * Histories: ai xem được khách thì xem được lịch sử (SĐT cũ -> mới đầy đủ theo quyết định #34; CCCD luôn che);
 * mục `PHONE_VIEWED`/`NATIONAL_ID_VIEWED` chỉ Quản trị/Quản lý; các cảnh báo dò số (`PHONE_LOOKUP`...) chỉ ở `/crm/audit-logs`.
 */
@Injectable()
export class CustomerHistoriesService {
  constructor(
    @InjectModel(CrmAuditLog.name)
    private readonly auditModel: Model<CrmAuditLogDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
  ) {}

  async listForCustomer(
    jwt: JwtPayload,
    customerId: string,
    query: ListHistoriesQueryDto,
  ): Promise<{ data: HistoryEntryDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    // Quản trị xem được cả khách đã xóa mềm (phục vụ khôi phục/đối soát); vai trò khác chỉ khách còn hoạt động.
    const customer = await this.repo.findOne(ctx.scope, customerId, {
      projection: { _id: 1 },
      deleted: ctx.actor.role === UserRole.ADMIN ? 'any' : 'exclude',
    });
    if (!customer) throw customerNotFound();

    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const hidden = [
      ...HIDDEN_HISTORY_ACTIONS,
      ...(isAdminOrManager(ctx.actor) ? [] : RESTRICTED_HISTORY_ACTIONS),
    ];
    const actionFilter = query.actions?.length
      ? { $in: query.actions.filter((action) => !hidden.includes(action)) }
      : { $nin: hidden };

    const filter: Record<string, unknown> = {
      customerId: new Types.ObjectId(customerId),
      action: actionFilter,
      ...(query.actorId && { actorId: new Types.ObjectId(query.actorId) }),
      ...dateRange(query.from, query.to),
    };
    const [rows, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) => toHistoryEntry(row as AuditRow)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Audit toàn CRM — route chỉ Quản trị (`@AdminOnly()`). */
  async listAll(
    query: ListAuditLogsQueryDto,
  ): Promise<{ data: AuditLogEntryDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = {
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.action && { action: query.action }),
      ...(query.actorId && { actorId: new Types.ObjectId(query.actorId) }),
      ...(query.customerId && {
        customerId: new Types.ObjectId(query.customerId),
      }),
      ...dateRange(query.from, query.to),
    };
    const [rows, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) => ({
        ...toHistoryEntry(row as AuditRow),
        entityType: row.entityType,
        entityId: String(row.entityId),
        customerId: row.customerId ? String(row.customerId) : null,
        requestId: row.requestId,
        ip: row.ip ?? null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}
