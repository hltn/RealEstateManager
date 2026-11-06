import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
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
import type { AutoStatusSource } from './customer.constants';
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
    const targetId = await this.resolveTargetId(dto, 'statusCode');

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
   * Dịch tình trạng đích từ request về id (FR-40): nhận `statusCode` (ưu tiên) hoặc `statusId` (cũ).
   * - Chỉ có `statusId`: dùng luôn (việc kiểm "còn hoạt động" do `lockAndAssert` làm trong transaction như trước).
   * - Có `statusCode`: dịch qua `CustomerRefsService` (không lọc hoạt động, để đặt lại đúng tình trạng hiện tại vẫn là no-op);
   *   có cả hai mà không cùng bản ghi, hoặc mã không tồn tại: 400.
   * - Không có gì: 400.
   */
  async resolveTargetId(
    input: { statusId?: string; statusCode?: string },
    field: string,
  ): Promise<Types.ObjectId> {
    if (input.statusId && !input.statusCode) {
      return new Types.ObjectId(input.statusId);
    }
    const { ref } = await this.refs.resolveSingleInput(
      'status',
      { id: input.statusId, code: input.statusCode },
      field,
      undefined,
      false,
    );
    if (!ref) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Cần gửi statusCode hoặc statusId',
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    return ref.id;
  }

  /**
   * Đổi tình trạng trong một transaction có sẵn (dùng chung cho API đơn lẻ và thao tác hàng loạt).
   * `version` vắng mặt (hàng loạt) thì không kiểm khóa lạc quan.
   * `autoSource` (PT-023): có -> đổi này do cơ chế tự động (cả chiều lên NET lẫn về INTERESTED), ghi thêm phần tử
   * `statusAutoSource` vào audit để lịch sử phân biệt với đổi tay; KHÔNG lưu vào khách (không còn dấu trên khách).
   */
  async applyChange(
    ctx: AccessContext,
    id: string,
    targetId: Types.ObjectId,
    options: {
      version?: number;
      reason?: string;
      autoSource?: AutoStatusSource;
    },
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<ChangeStatusResponseDto> {
    const { version, reason, autoSource } = options;
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
    // Nhãn + mã của tình trạng cũ/mới: `statusCode` được ghi kép cùng `statusId`; mã không đổi khi đổi nhãn (FR-40).
    const maps = await this.refs.resolve({
      statusIds: [before.statusId, targetId],
    });
    const fromStatus = maps.statuses.get(String(before.statusId));
    const toStatus = maps.statuses.get(String(targetId))!;
    const now = new Date();
    const matched = await this.repo.updateOne(
      ctx.scope,
      id,
      version === undefined ? {} : { __v: version },
      {
        $set: {
          statusId: targetId,
          statusCode: toStatus.code,
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
            fromCode: fromStatus?.code ?? null,
            toCode: toStatus.code,
          },
          ...(autoSource
            ? [{ field: 'statusAutoSource', from: null, to: autoSource }]
            : []),
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
