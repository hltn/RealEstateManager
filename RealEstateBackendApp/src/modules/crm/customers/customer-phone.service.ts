import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  CrmAuditAction,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import { CareTeamRequestStatus } from '../care-teams/care-team.constants';
import {
  CareTeamRequest,
  CareTeamRequestDocument,
} from '../care-teams/schemas/care-team-request.schema';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import {
  customerNotFound,
  normalizePhoneOrThrow,
  resolveClientSource,
} from './customer.errors';
import { CustomersRepository } from './customers.repository';
import {
  PhoneLookupResponseDto,
  PhoneViewResponseDto,
} from './dtos/customer-response.dto';
import { PhoneLookupDto, PhoneViewDto } from './dtos/customer-request.dto';

type ExistingByPhone = NonNullable<
  Awaited<ReturnType<CustomersRepository['findByPhoneForDuplicateCheck']>>
>;

/**
 * Tra trùng SĐT (`phone-lookups`) và xem số đầy đủ (`phone-views`) — tài liệu 04 mục 6.1, 6.7.
 *
 * Quy tắc riêng tư: người tra chỉ biết "do [tên] chăm sóc" khi khách NGOÀI phạm vi của họ (không lộ họ tên, email,
 * SĐT); khách ngoài phạm vi bị tra thì ghi audit `PHONE_LOOKUP` để phát hiện dò số.
 */
@Injectable()
export class CustomerPhoneService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(CareTeamRequest.name)
    private readonly requestModel: Model<CareTeamRequestDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly rateLimit: CrmRateLimitService,
    private readonly abuse: CrmAbuseMonitorService,
    private readonly audit: CrmAuditLogService,
    private readonly settings: CrmSettingsService,
  ) {}

  async lookup(
    jwt: JwtPayload,
    dto: PhoneLookupDto,
    clientType?: string,
  ): Promise<PhoneLookupResponseDto> {
    await this.rateLimit.consume(jwt.sub, 'PHONE_LOOKUP');
    const ctx = await this.access.resolve(jwt);
    const normalizedPhone = normalizePhoneOrThrow(dto.phone);

    const existing =
      await this.repo.findByPhoneForDuplicateCheck(normalizedPhone);
    if (!existing) {
      return {
        normalizedPhone,
        exists: false,
        isAccessible: false,
        canRequestJoin: false,
        hasPendingRequest: false,
      };
    }
    const described = await this.describeExisting(
      ctx,
      existing,
      resolveClientSource(clientType).auditSource,
    );
    return { normalizedPhone, ...described };
  }

  /**
   * Mô tả khách đã có SĐT này theo góc nhìn của `ctx.actor` (dùng cho `phone-lookups` và lỗi trùng khi tạo/sửa).
   * Khách ngoài phạm vi: trả `customerRef` + `caredByName` (tên hiển thị phụ trách chính) và ghi `PHONE_LOOKUP`.
   * Khách đã xóa mềm: chỉ Quản trị biết/thao tác được; người khác chỉ biết "đã tồn tại".
   */
  async describeExisting(
    ctx: AccessContext,
    existing: ExistingByPhone,
    source: CrmAuditSource = 'WEB',
  ): Promise<Omit<PhoneLookupResponseDto, 'normalizedPhone'>> {
    const isAdmin = ctx.actor.role === UserRole.ADMIN;
    const isDeleted =
      existing.deletedAt !== null && existing.deletedAt !== undefined;
    const adminExtra = isAdmin ? { isDeleted } : {};

    const isAccessible = isDeleted
      ? isAdmin
      : (await this.repo.findOne(ctx.scope, existing._id, {
          projection: { _id: 1 },
        })) !== null;

    if (isAccessible) {
      return {
        exists: true,
        isAccessible: true,
        customerId: String(existing._id),
        canRequestJoin: false,
        hasPendingRequest: false,
        ...adminExtra,
      };
    }
    if (isDeleted) {
      return {
        exists: true,
        isAccessible: false,
        canRequestJoin: false,
        hasPendingRequest: false,
      };
    }

    const [caredByName, hasPendingRequest] = await Promise.all([
      this.primaryName(existing.primaryAssigneeId),
      this.hasPendingJoinRequest(existing._id, ctx.actor.userId),
    ]);
    await this.recordLookupProbe(ctx, existing._id, source);
    return {
      exists: true,
      isAccessible: false,
      customerRef: String(existing._id),
      caredByName,
      canRequestJoin:
        ctx.actor.role === UserRole.MANAGER ||
        ctx.actor.role === UserRole.STAFF,
      hasPendingRequest,
    };
  }

  /** Lỗi 409 chuẩn khi tạo/sửa trùng SĐT (tài liệu 05 mục 5). */
  async buildDuplicateError(
    ctx: AccessContext,
    phone: string,
    source: CrmAuditSource = 'WEB',
  ): Promise<BusinessException> {
    // Lỗi 409 trùng SĐT tiết lộ đúng thông tin của `phone-lookups` (tên người phụ trách + customerRef), nên dùng
    // CHUNG hạn mức 30 lần/phút/người: không cho lách giới hạn dò số bằng cách gọi tạo/sửa khách liên tục.
    // Vượt hạn mức => 429 thay cho 409; Redis lỗi => 503 (fail-closed).
    await this.rateLimit.consume(String(ctx.actor.userId), 'PHONE_LOOKUP');
    const existing = await this.repo.findByPhoneForDuplicateCheck(phone);
    const details: Record<string, unknown> = existing
      ? { ...(await this.describeExisting(ctx, existing, source)) }
      : {};
    const caredBy = details.caredByName as string | null | undefined;
    return new BusinessException(
      ErrorCode.CUSTOMER_PHONE_DUPLICATED,
      caredBy
        ? `Đã có khách này, do ${caredBy} chăm sóc`
        : 'Đã có khách với số điện thoại này',
      HttpStatus.CONFLICT,
      details,
    );
  }

  /**
   * Xem số đầy đủ / gọi / sao chép: kiểm phạm vi (ngoài phạm vi => 404), ghi audit `PHONE_VIEWED` KHÔNG lưu số
   * (chỉ lưu mục đích) trong cùng transaction với lần đọc, rồi mới trả số.
   */
  async view(
    jwt: JwtPayload,
    customerId: string,
    dto: PhoneViewDto,
    clientType?: string,
  ): Promise<PhoneViewResponseDto> {
    await this.rateLimit.consume(jwt.sub, 'PHONE_VIEW');
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    const viewedAt = new Date();
    const phone = await withTransaction(this.connection, async (session) => {
      const customer = await this.repo.findOne(ctx.scope, customerId, {
        session,
        projection: { phone: 1 },
      });
      if (!customer) throw customerNotFound();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: customerId,
          customerId,
          action: CrmAuditAction.PHONE_VIEWED,
          actor: jwt,
          reason: dto.purpose,
          source: auditSource,
        },
        session,
      );
      return customer.phone;
    });

    const { phoneViewAlertPerHour } = await this.settings.get();
    await this.abuse.trackPhoneView(jwt.sub, phoneViewAlertPerHour);
    return { phone, viewedAt: viewedAt.toISOString() };
  }

  private async primaryName(
    userId: Types.ObjectId | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const user = await this.userModel
      .findById(userId)
      .select('displayName')
      .lean()
      .exec();
    return user?.displayName ?? null;
  }

  /** Người này đã có đề nghị tham gia nhóm chăm sóc khách này đang chờ duyệt (M3). */
  private async hasPendingJoinRequest(
    customerId: Types.ObjectId,
    requesterId: Types.ObjectId,
  ): Promise<boolean> {
    const pending = await this.requestModel
      .exists({
        customerId,
        requesterId,
        status: CareTeamRequestStatus.PENDING,
      })
      .exec();
    return pending !== null;
  }

  /** Ghi `PHONE_LOOKUP` (khách ngoài phạm vi) — không lưu số điện thoại. */
  private async recordLookupProbe(
    ctx: AccessContext,
    customerId: Types.ObjectId,
    source: CrmAuditSource,
  ): Promise<void> {
    await withTransaction(this.connection, (session) =>
      this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: customerId,
          customerId,
          action: CrmAuditAction.PHONE_LOOKUP,
          actor: { sub: String(ctx.actor.userId) },
          source,
        },
        session,
      ),
    );
  }
}
