import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import { CustomerAccessService } from './access/customer-access.service';
import { customerNotFound, resolveClientSource } from './customer.errors';
import { CustomersRepository } from './customers.repository';
import { PhoneViewResponseDto } from './dtos/customer-response.dto';
import { PhoneViewDto } from './dtos/customer-request.dto';

/** 409: khách không có SĐT (`phone` null, FR-04) nên không có gì để xem/gọi/sao chép. */
export const customerPhoneNotSet = (): BusinessException =>
  new BusinessException(
    ErrorCode.CUSTOMER_PHONE_NOT_SET,
    'Khách chưa có số điện thoại',
    HttpStatus.CONFLICT,
  );

/**
 * Xem số đầy đủ (`phone-views`) — tài liệu 04 mục 6.7. Luồng tra trùng SĐT (`phone-lookups`) đã bị gỡ hẳn ở v1.0.5
 * (FR-03, FR-20): hai khách được phép cùng SĐT nên không còn gì để tra.
 */
@Injectable()
export class CustomerPhoneService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly rateLimit: CrmRateLimitService,
    private readonly abuse: CrmAbuseMonitorService,
    private readonly audit: CrmAuditLogService,
    private readonly settings: CrmSettingsService,
  ) {}

  /**
   * Xem số đầy đủ / gọi / sao chép. Thứ tự (FR-04): (1) kiểm phạm vi — ngoài phạm vi/không tồn tại => 404, không
   * lộ khách; (2) khách `phone` null => 409 `CUSTOMER_PHONE_NOT_SET` (không consume rate-limit, không ghi audit);
   * (3) rate-limit `PHONE_VIEW`; (4) ghi audit `PHONE_VIEWED` KHÔNG lưu số (chỉ lưu mục đích) trong transaction,
   * rồi mới trả số.
   */
  async view(
    jwt: JwtPayload,
    customerId: string,
    dto: PhoneViewDto,
    clientType?: string,
  ): Promise<PhoneViewResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    // Kiểm phạm vi và `phone` null TRƯỚC rate-limit: khách không có số không đốt lượt xem của người dùng.
    const found = await this.repo.findOne(ctx.scope, customerId, {
      projection: { phone: 1 },
    });
    if (!found) throw customerNotFound();
    if (!found.phone) throw customerPhoneNotSet();

    await this.rateLimit.consume(jwt.sub, 'PHONE_VIEW');

    const viewedAt = new Date();
    // Audit phải commit xong rồi mới trả số: ghi thất bại thì không lộ số mà không có dấu vết.
    await withTransaction(this.connection, (session) =>
      this.audit.record(
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
      ),
    );

    const { phoneViewAlertPerHour } = await this.settings.get();
    await this.abuse.trackPhoneView(jwt.sub, phoneViewAlertPerHour);
    return { phone: found.phone, viewedAt: viewedAt.toISOString() };
  }
}
