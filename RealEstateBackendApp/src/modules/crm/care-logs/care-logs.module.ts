import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { RedisModule } from '../../../shared/redis/redis.module';
import { StorageModule } from '../../../shared/storage/storage.module';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { AppointmentsCoreModule } from '../appointments/appointments-core.module';
import { CrmSettingsModule } from '../crm-settings/crm-settings.module';
import { CustomersModule } from '../customers/customers.module';
import { RemindersCoreModule } from '../reminders/reminders-core.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AttachmentCleanupService } from './attachment-cleanup.service';
import { CareLogAttachmentsController } from './care-log-attachments.controller';
import { CareLogAttachmentsService } from './care-log-attachments.service';
import { CareLogsController } from './care-logs.controller';
import { CareLogsService } from './care-logs.service';
import { CareLog, CareLogSchema } from './schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentSchema,
} from './schemas/crm-attachment.schema';

/** Nhật ký chăm sóc và ảnh đính kèm (M3, tài liệu 04 mục 2.3 `crm/care-logs`). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CareLog.name, schema: CareLogSchema },
      { name: CrmAttachment.name, schema: CrmAttachmentSchema },
    ]),
    CustomersModule,
    AppointmentsCoreModule,
    RemindersCoreModule,
    NotificationsModule,
    CrmSettingsModule,
    CrmAuditLogModule,
    CrmSecurityModule,
    RedisModule,
    StorageModule,
  ],
  controllers: [CareLogsController, CareLogAttachmentsController],
  providers: [
    IdempotencyService,
    CareLogsService,
    CareLogAttachmentsService,
    AttachmentCleanupService,
  ],
  // `CareLogsService`: hoàn thành lịch hẹn kèm nhật ký; `AttachmentCleanupService`: job dọn ảnh của scheduler (M5).
  exports: [CareLogsService, AttachmentCleanupService],
})
export class CareLogsModule {}
