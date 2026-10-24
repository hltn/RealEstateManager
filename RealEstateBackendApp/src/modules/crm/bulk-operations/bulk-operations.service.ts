import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { CrmAuditSource } from '../audit-logs/crm-audit.constants';
import { planAddMembers } from '../care-teams/care-team.rules';
import { CareTeamService } from '../care-teams/care-team.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import {
  AccessContext,
  CustomerAccessService,
} from '../customers/access/customer-access.service';
import { isAdminOrManager } from '../customers/access/customer-scope';
import {
  insufficientRole,
  resolveClientSource,
} from '../customers/customer.errors';
import { CustomerStatusChangeService } from '../customers/customer-status-change.service';
import { BulkTaggingService } from './bulk-tagging.service';
import {
  BulkOperationDto,
  BulkOperationPayloadDto,
  BulkOperationResponseDto,
  BulkOperationType,
} from './dtos/bulk-operation.dto';

const BULK_STATUS_REASON = 'Thao tác hàng loạt';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const validationFailed = (message: string, details?: Record<string, unknown>) =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
    details,
  );

/** Mã lỗi trả cho từng khách thất bại: lỗi nghiệp vụ giữ nguyên mã; lỗi không lường trước ẩn thành `INTERNAL_ERROR`. */
const toErrorCode = (error: unknown): string => {
  if (error instanceof BusinessException) return String(error.errorCode);
  if (error instanceof HttpException) {
    return error.getStatus() === HttpStatus.FORBIDDEN
      ? ErrorCode.INSUFFICIENT_ROLE
      : ErrorCode.VALIDATION_FAILED;
  }
  return ErrorCode.INTERNAL_ERROR;
};

/**
 * Thao tác hàng loạt (`POST /crm/customer-bulk-operations`, tài liệu 05 mục 2.3): ≤ 200 khách, xử lý đồng bộ,
 * MỖI KHÁCH MỘT transaction riêng (cùng audit) nên khách lỗi không kéo khách khác rollback; kết quả báo từng khách
 * thành công/thất bại. Khách ngoài phạm vi người gọi (hoặc không tồn tại/đã xóa) đều báo `CUSTOMER_NOT_FOUND`,
 * không lộ sự tồn tại. Mỗi khách đi qua đúng đường nghiệp vụ của thao tác đơn lẻ (cùng quy tắc, cùng audit).
 */
@Injectable()
export class BulkOperationsService {
  private readonly logger = new Logger(BulkOperationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly access: CustomerAccessService,
    private readonly statusChanges: CustomerStatusChangeService,
    private readonly careTeam: CareTeamService,
    private readonly tagging: BulkTaggingService,
    private readonly rateLimit: CrmRateLimitService,
  ) {}

  async run(
    jwt: JwtPayload,
    dto: BulkOperationDto,
    clientType?: string,
  ): Promise<BulkOperationResponseDto> {
    await this.rateLimit.consume(jwt.sub, 'BULK_OPERATION');
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const apply = await this.buildApplier(ctx, dto, auditSource);

    const result: BulkOperationResponseDto = { succeeded: [], failed: [] };
    for (const customerId of dto.customerIds) {
      try {
        await withTransaction(this.connection, (session) =>
          apply(customerId, session),
        );
        result.succeeded.push(customerId);
      } catch (error) {
        const errorCode = toErrorCode(error);
        if (errorCode === ErrorCode.INTERNAL_ERROR) {
          this.logger.error(
            `Thao tác hàng loạt ${dto.type} lỗi với một khách: ${(error as Error).message}`,
          );
        }
        result.failed.push({ customerId, errorCode });
      }
    }
    return result;
  }

  /** Kiểm quyền + payload theo loại thao tác (400/403 cho cả lô) rồi trả hàm xử lý MỘT khách trong transaction. */
  private async buildApplier(
    ctx: AccessContext,
    dto: BulkOperationDto,
    source: CrmAuditSource,
  ): Promise<(customerId: string, session: ClientSession) => Promise<unknown>> {
    const { payload } = dto;
    switch (dto.type) {
      case BulkOperationType.CHANGE_STATUS: {
        if (!payload.statusId) {
          throw validationFailed('CHANGE_STATUS cần payload.statusId', {
            field: 'payload.statusId',
          });
        }
        const targetId = oid(payload.statusId);
        return (customerId, session) =>
          this.statusChanges.applyChange(
            ctx,
            customerId,
            targetId,
            { reason: BULK_STATUS_REASON },
            source,
            session,
          );
      }
      case BulkOperationType.ASSIGN:
        return this.buildAssign(ctx, payload, source);
      default:
        return this.buildTagging(ctx, dto, source);
    }
  }

  /** ADD_TAGS / REMOVE_TAGS: cần `payload.tagIds`; thẻ gắn thêm phải còn tồn tại (400 cho cả lô). */
  private async buildTagging(
    ctx: AccessContext,
    dto: BulkOperationDto,
    source: CrmAuditSource,
  ) {
    const tagIds = (dto.payload.tagIds ?? []).map(oid);
    if (tagIds.length === 0) {
      throw validationFailed(`${dto.type} cần payload.tagIds`, {
        field: 'payload.tagIds',
      });
    }
    const mode = dto.type === BulkOperationType.ADD_TAGS ? 'ADD' : 'REMOVE';
    await this.tagging.prepare(mode, tagIds);
    return (customerId: string, session: ClientSession) =>
      this.tagging.applyToCustomer(
        ctx,
        customerId,
        mode,
        tagIds,
        source,
        session,
      );
  }

  private buildAssign(
    ctx: AccessContext,
    payload: BulkOperationPayloadDto,
    source: CrmAuditSource,
  ) {
    // Nhân viên không được phân người chăm sóc hàng loạt (ma trận 4.2).
    if (!isAdminOrManager(ctx.actor)) throw insufficientRole();
    const memberIds = (payload.memberIds ?? []).map(oid);
    const primaryUserId = payload.primaryUserId
      ? oid(payload.primaryUserId)
      : undefined;
    if (memberIds.length === 0 && !primaryUserId) {
      throw validationFailed(
        'ASSIGN cần payload.memberIds hoặc primaryUserId',
        {
          field: 'payload',
        },
      );
    }
    return (customerId: string, session: ClientSession) =>
      this.careTeam.applyInSession(
        ctx,
        customerId,
        {
          // Quản trị/Quản lý đã được chặn ở trên; phạm vi khách do `CustomerScope` bảo đảm.
          authorize: () => undefined,
          plan: (current, now) =>
            planAddMembers(
              current,
              { userIds: memberIds, primaryUserId },
              ctx.actor.userId,
              now,
              { skipExisting: true, allowPrimaryChange: true },
            ),
          restrictToActorScope: true,
          source,
        },
        session,
      );
  }
}
