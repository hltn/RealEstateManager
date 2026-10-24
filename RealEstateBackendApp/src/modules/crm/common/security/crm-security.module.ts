import { Module } from '@nestjs/common';
import { RedisModule } from '../../../../shared/redis/redis.module';
import { NotificationsModule } from '../../../notifications/notifications.module';
import { CrmAuditLogModule } from '../../audit-logs/crm-audit-log.module';
import { CrmAbuseMonitorService } from './crm-abuse-monitor.service';
import { CrmRateLimitService } from './crm-rate-limit.service';

/** Giới hạn tốc độ theo người dùng + phát hiện bất thường (dùng Redis). */
@Module({
  imports: [RedisModule, CrmAuditLogModule, NotificationsModule],
  providers: [CrmRateLimitService, CrmAbuseMonitorService],
  exports: [CrmRateLimitService, CrmAbuseMonitorService],
})
export class CrmSecurityModule {}
