import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { RedisModule } from '../../../shared/redis/redis.module';
import { CareTeamsModule } from '../care-teams/care-teams.module';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { CustomersModule } from '../customers/customers.module';
import { BulkOperationsController } from './bulk-operations.controller';
import { BulkOperationsService } from './bulk-operations.service';
import { BulkTaggingService } from './bulk-tagging.service';

/** Thao tác hàng loạt trên khách: đổi tình trạng, phân người chăm sóc (M3), gắn/gỡ thẻ (M4). */
@Module({
  imports: [
    CustomersModule,
    CareTeamsModule,
    CrmAuditLogModule,
    CrmSecurityModule,
    RedisModule,
  ],
  controllers: [BulkOperationsController],
  providers: [IdempotencyService, BulkOperationsService, BulkTaggingService],
})
export class BulkOperationsModule {}
