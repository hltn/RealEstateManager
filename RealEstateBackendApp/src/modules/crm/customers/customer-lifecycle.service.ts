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
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CustomerAccessService } from './access/customer-access.service';
import { CustomerCareAnonymizerService } from './customer-care-anonymizer.service';
import { CustomerPersonaAnonymizerService } from './customer-persona-anonymizer.service';
import { isAdminOrManager } from './access/customer-scope';
import {
  ANONYMIZED_NAME,
  ANONYMIZED_PLACEHOLDER,
  CRITERIA_KEYS,
} from './customer.constants';
import {
  customerNotFound,
  insufficientRole,
  resolveClientSource,
} from './customer.errors';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import {
  AnonymizeCustomerDto,
  RestoreCustomerDto,
} from './dtos/customer-request.dto';
import {
  AnonymizeResponseDto,
  CustomerDetailDto,
} from './dtos/customer-response.dto';

/** Trường trong `crm_audit_logs.changes` chứa dữ liệu cá nhân, bị ghi đè khi ẩn danh hóa (04 mục 7.3). */
const PII_AUDIT_FIELDS = ['fullName', 'phone', 'email', 'nationalId'];
/**
 * Trường chứa văn bản tự do (có thể có PII) khớp theo MẪU regex — module sau (M4 chân dung) chỉ cần thêm mẫu vào
 * đây. Hiện có: mô tả tiêu chí (`criteria.<key>.description`, tối đa 1000 ký tự), nhật ký chăm sóc
 * (`careLog.content`, `careLog.nextAction.suggestion`, M3), giá trị chân dung (`persona.<fieldKey>`, giá trị tự do về
 * nghề nghiệp/gia đình... — M4) và thẻ của khách (`tags`, M4).
 */
export const PII_AUDIT_FIELD_PATTERNS = [
  String.raw`^criteria\..+\.description$`,
  String.raw`^careLog\.(content|nextAction\.suggestion)$`,
  String.raw`^persona\..+$`,
  String.raw`^tags$`,
];
/** Mục đích xem số là danh sách đóng (VIEW/CALL/COPY) nên là `reason` duy nhất được giữ lại. */
const KEEP_REASON_ACTIONS = ['PHONE_VIEWED'];

/**
 * Xóa mềm / khôi phục / ẩn danh hóa khách (tài liệu 04 mục 7.3, 05 mục 2.3).
 * - Xóa mềm: Quản trị và Quản lý (trong phạm vi); khôi phục và ẩn danh hóa: chỉ Quản trị.
 * - Ẩn danh hóa KHÔNG hoàn tác được: ghi đè PII, giữ khung thống kê (tình trạng, nguồn, khu vực, dự án, nhóm chăm
 *   sóc, tiến độ) và tự xóa mềm; đồng thời ghi đè dữ liệu cá nhân trong `changes` của audit CỦA KHÁCH ĐÓ — đây là
 *   thao tác DUY NHẤT được sửa `crm_audit_logs`, thực hiện trong cùng transaction.
 */
@Injectable()
export class CustomerLifecycleService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly audit: CrmAuditLogService,
    private readonly customers: CustomersService,
    private readonly careData: CustomerCareAnonymizerService,
    private readonly personaData: CustomerPersonaAnonymizerService,
  ) {}

  async softDelete(
    jwt: JwtPayload,
    id: string,
    reason: string,
    clientType?: string,
  ): Promise<void> {
    const ctx = await this.access.resolve(jwt);
    if (!isAdminOrManager(ctx.actor)) throw insufficientRole();
    const { auditSource } = resolveClientSource(clientType);

    await withTransaction(this.connection, async (session) => {
      const exists = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { _id: 1 },
      });
      if (!exists) throw customerNotFound();
      const now = new Date();
      await this.repo.updateOne(
        ctx.scope,
        id,
        {},
        {
          $set: {
            deletedAt: now,
            deletedBy: ctx.actor.userId,
            lastUpdatedAt: now,
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
          action: CrmAuditAction.CUSTOMER_DELETED,
          actor: { sub: String(ctx.actor.userId) },
          reason,
          source: auditSource,
        },
        session,
      );
    });
  }

  async restore(
    jwt: JwtPayload,
    dto: RestoreCustomerDto,
    clientType?: string,
  ): Promise<CustomerDetailDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    const restored = await withTransaction(this.connection, async (session) => {
      const deleted = await this.repo.findOne(ctx.scope, dto.customerId, {
        session,
        deleted: 'only',
        projection: { anonymizedAt: 1 },
      });
      if (!deleted) throw customerNotFound();
      if (deleted.anonymizedAt) throw this.anonymizedError();

      const now = new Date();
      await this.repo.updateOne(
        ctx.scope,
        dto.customerId,
        {},
        {
          $set: {
            deletedAt: null,
            deletedBy: null,
            lastUpdatedAt: now,
            lastUpdatedBy: ctx.actor.userId,
          },
          $inc: { __v: 1 },
        },
        { session, deleted: 'only' },
      );
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: dto.customerId,
          customerId: dto.customerId,
          action: CrmAuditAction.CUSTOMER_RESTORED,
          actor: { sub: String(ctx.actor.userId) },
          reason: dto.reason ?? null,
          source: auditSource,
        },
        session,
      );
      return (await this.repo.findOne(ctx.scope, dto.customerId, {
        session,
      }))!;
    });
    return this.customers.toDetailDto(restored, ctx);
  }

  async anonymize(
    jwt: JwtPayload,
    dto: AnonymizeCustomerDto,
    clientType?: string,
  ): Promise<AnonymizeResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const customerId = new Types.ObjectId(dto.customerId);

    const anonymizedAt = await withTransaction(
      this.connection,
      async (session) => {
        const customer = await this.repo.findOne(ctx.scope, customerId, {
          session,
          deleted: 'any',
          projection: { anonymizedAt: 1, deletedAt: 1 },
        });
        if (!customer) throw customerNotFound();
        if (customer.anonymizedAt) throw this.anonymizedError();

        const now = new Date();
        await this.overwriteAuditPii(customerId, session);
        await this.careData.anonymize(customerId, now, session);
        await this.personaData.anonymize(customerId, session);
        await this.repo.updateOne(
          ctx.scope,
          customerId,
          {},
          {
            $set: {
              fullName: ANONYMIZED_NAME,
              // Giữ unique index `phone` hợp lệ cho khách đã ẩn danh mà không còn số thật.
              phone: `anonymized:${String(customerId)}`,
              email: null,
              nationalId: null,
              nationalIdLast4: null,
              hasNationalId: false,
              searchText: '',
              'dataConsent.note': null,
              ...Object.fromEntries(
                CRITERIA_KEYS.map((key) => [`criteria.${key}.description`, '']),
              ),
              ...(customer.deletedAt
                ? {}
                : { deletedAt: now, deletedBy: ctx.actor.userId }),
              anonymizedAt: now,
              lastUpdatedAt: now,
              lastUpdatedBy: ctx.actor.userId,
            },
            $inc: { __v: 1 },
          },
          { session, deleted: 'any' },
        );
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CUSTOMER,
            entityId: customerId,
            customerId,
            action: CrmAuditAction.CUSTOMER_ANONYMIZED,
            actor: { sub: String(ctx.actor.userId) },
            reason: dto.reason,
            source: auditSource,
          },
          session,
        );
        return now;
      },
    );
    return {
      customerId: dto.customerId,
      anonymizedAt: anonymizedAt.toISOString(),
    };
  }

  /**
   * Ghi đè PII trong audit của khách: giá trị cũ -> mới của họ tên/SĐT/email/CCCD thành dấu thay thế, và xóa `reason`
   * tự do (có thể chứa tên). Chạy bằng pipeline update trên collection thô (audit là bất biến, không có model update).
   */
  private async overwriteAuditPii(
    customerId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.connection.collection('crm_audit_logs').updateMany(
      { customerId },
      [
        {
          $set: {
            changes: {
              $map: {
                input: { $ifNull: ['$changes', []] },
                as: 'change',
                in: {
                  $cond: [
                    {
                      $or: [
                        { $in: ['$$change.field', PII_AUDIT_FIELDS] },
                        ...PII_AUDIT_FIELD_PATTERNS.map((regex) => ({
                          $regexMatch: { input: '$$change.field', regex },
                        })),
                      ],
                    },
                    {
                      field: '$$change.field',
                      from: ANONYMIZED_PLACEHOLDER,
                      to: ANONYMIZED_PLACEHOLDER,
                    },
                    '$$change',
                  ],
                },
              },
            },
            reason: {
              $cond: [
                { $in: ['$action', KEEP_REASON_ACTIONS] },
                '$reason',
                null,
              ],
            },
          },
        },
      ],
      { session },
    );
  }

  private anonymizedError(): BusinessException {
    return new BusinessException(
      ErrorCode.CUSTOMER_ANONYMIZED,
      'Khách hàng này đã được ẩn danh hóa, không thể thực hiện thao tác',
      HttpStatus.CONFLICT,
    );
  }
}
