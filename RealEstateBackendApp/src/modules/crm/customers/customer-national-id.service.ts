import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import {
  CrmAuditLog,
  CrmAuditLogDocument,
} from '../audit-logs/schemas/crm-audit-log.schema';
import { PiiCryptoService } from '../common/crypto/pii-crypto.service';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import { isAdminOrManager } from './access/customer-scope';
import { CareRole } from './customer.constants';
import {
  assertValidNationalId,
  customerNotFound,
  insufficientRole,
  resolveClientSource,
} from './customer.errors';
import { CustomersRepository } from './customers.repository';
import {
  NationalIdViewDto,
  SetNationalIdDto,
} from './dtos/customer-request.dto';
import {
  NationalIdSummaryDto,
  NationalIdViewEntryDto,
  NationalIdViewResponseDto,
} from './dtos/customer-response.dto';
import {
  lastFourDigits,
  maskNationalId,
  nationalIdAad,
} from './utils/customer-rules.util';

/**
 * CCCD (C9, tài liệu 04 mục 7.3): mã hóa AES-256-GCM qua `PiiCryptoService` với AAD `${customerId}:nationalId`.
 * CCCD thô CHỈ xuất hiện trong response của `national-id-views` (kèm `Cache-Control: no-store` ở controller) —
 * không bao giờ vào log, audit (`changes` chỉ có dạng che `••••1234`) hay response khác.
 */
@Injectable()
export class CustomerNationalIdService {
  private readonly logger = new Logger(CustomerNationalIdService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CrmAuditLog.name)
    private readonly auditModel: Model<CrmAuditLogDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly pii: PiiCryptoService,
    private readonly rateLimit: CrmRateLimitService,
    private readonly abuse: CrmAbuseMonitorService,
    private readonly audit: CrmAuditLogService,
  ) {}

  /** Nhập/sửa CCCD: Quản trị, Quản lý (trong phạm vi) và Nhân viên trong nhóm chăm sóc. */
  async set(
    jwt: JwtPayload,
    id: string,
    dto: SetNationalIdDto,
    clientType?: string,
  ): Promise<NationalIdSummaryDto> {
    assertValidNationalId(dto.nationalId);
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const last4 = lastFourDigits(dto.nationalId);
    const cipher = this.pii.encrypt(dto.nationalId, nationalIdAad(id));

    await withTransaction(this.connection, async (session) => {
      const before = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { nationalIdLast4: 1, hasNationalId: 1 },
      });
      if (!before) throw customerNotFound();
      await this.repo.updateOne(
        ctx.scope,
        id,
        {},
        {
          $set: {
            nationalId: cipher,
            nationalIdLast4: last4,
            hasNationalId: true,
            lastUpdatedAt: new Date(),
            lastUpdatedBy: ctx.actor.userId,
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: id,
          customerId: id,
          action: CrmAuditAction.NATIONAL_ID_UPDATED,
          actor: { sub: String(ctx.actor.userId) },
          changes: [
            {
              field: 'nationalId',
              from: maskNationalId(before.nationalIdLast4),
              to: maskNationalId(last4),
            },
          ],
          source: auditSource,
        },
        session,
      );
    });
    return { hasNationalId: true, nationalIdMasked: maskNationalId(last4) };
  }

  /** Xóa CCCD khỏi hồ sơ. Khách chưa có CCCD: no-op (idempotent). */
  async remove(
    jwt: JwtPayload,
    id: string,
    clientType?: string,
  ): Promise<void> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    await withTransaction(this.connection, async (session) => {
      const before = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { nationalIdLast4: 1, hasNationalId: 1 },
      });
      if (!before) throw customerNotFound();
      if (!before.hasNationalId) return;
      await this.repo.updateOne(
        ctx.scope,
        id,
        {},
        {
          $set: {
            nationalId: null,
            nationalIdLast4: null,
            hasNationalId: false,
            lastUpdatedAt: new Date(),
            lastUpdatedBy: ctx.actor.userId,
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: id,
          customerId: id,
          action: CrmAuditAction.NATIONAL_ID_REMOVED,
          actor: { sub: String(ctx.actor.userId) },
          changes: [
            {
              field: 'nationalId',
              from: maskNationalId(before.nationalIdLast4),
              to: null,
            },
          ],
          source: auditSource,
        },
        session,
      );
    });
  }

  /**
   * Xem CCCD đầy đủ: Quản trị, Quản lý (trong phạm vi) hoặc Nhân viên LÀ phụ trách chính. Ghi audit
   * `NATIONAL_ID_VIEWED` TRƯỚC khi trả số (cùng transaction). Throttle 10/phút/người.
   */
  async view(
    jwt: JwtPayload,
    id: string,
    dto: NationalIdViewDto,
    clientType?: string,
  ): Promise<NationalIdViewResponseDto> {
    await this.rateLimit.consume(jwt.sub, 'NATIONAL_ID_VIEW');
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    const viewedAt = new Date();
    const nationalId = await withTransaction(
      this.connection,
      async (session) => {
        const customer = await this.repo.findOne(ctx.scope, id, {
          session,
          projection: { careTeam: 1, hasNationalId: 1, nationalId: 1 },
        });
        if (!customer) throw customerNotFound();
        if (!this.canRevealNationalId(ctx, customer.careTeam)) {
          throw new BusinessException(
            ErrorCode.NATIONAL_ID_FORBIDDEN,
            'Bạn không có quyền xem CCCD đầy đủ của khách này',
            HttpStatus.FORBIDDEN,
          );
        }
        if (!customer.hasNationalId || !customer.nationalId) {
          throw new BusinessException(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Khách hàng chưa có CCCD',
            HttpStatus.NOT_FOUND,
          );
        }
        const plain = this.decryptOrFail(customer.nationalId, id);
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CUSTOMER,
            entityId: id,
            customerId: id,
            action: CrmAuditAction.NATIONAL_ID_VIEWED,
            actor: { sub: String(ctx.actor.userId) },
            reason: dto.purpose ?? null,
            source: auditSource,
          },
          session,
        );
        return plain;
      },
    );
    await this.abuse.trackNationalIdView(jwt.sub);
    return { nationalId, viewedAt: viewedAt.toISOString() };
  }

  /** Nhật ký các lần xem CCCD của khách: chỉ Quản trị và Quản lý (trong phạm vi). */
  async listViews(
    jwt: JwtPayload,
    id: string,
    query: { page?: number; limit?: number },
  ): Promise<{ data: NationalIdViewEntryDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    if (!isAdminOrManager(ctx.actor)) throw insufficientRole();
    const customer = await this.repo.findOne(ctx.scope, id, {
      projection: { _id: 1 },
    });
    if (!customer) throw customerNotFound();

    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter = {
      customerId: new Types.ObjectId(id),
      action: CrmAuditAction.NATIONAL_ID_VIEWED,
    };
    const [rows, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .select('actorId actorName reason source createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) => ({
        viewer: { id: String(row.actorId), displayName: row.actorName },
        viewedAt: row.createdAt.toISOString(),
        purpose: row.reason ?? null,
        source: row.source,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  private canRevealNationalId(
    ctx: AccessContext,
    careTeam: Array<{ userId: Types.ObjectId; role: CareRole }> | undefined,
  ): boolean {
    if (isAdminOrManager(ctx.actor)) return true;
    return (careTeam ?? []).some(
      (member) =>
        member.role === CareRole.PRIMARY &&
        member.userId.equals(ctx.actor.userId),
    );
  }

  /** Giải mã thất bại (sai khóa/AAD/dữ liệu hỏng) => 500 chung, KHÔNG log bản mã hay khóa. */
  private decryptOrFail(
    cipher: Parameters<PiiCryptoService['decrypt']>[0],
    customerId: string,
  ): string {
    try {
      return this.pii.decrypt(cipher, nationalIdAad(customerId));
    } catch {
      this.logger.error(`Không giải mã được CCCD của khách ${customerId}`);
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        'Không đọc được CCCD, vui lòng liên hệ quản trị viên',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
