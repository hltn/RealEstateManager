import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { RedisModule } from '../../../shared/redis/redis.module';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import {
  CrmAuditLog,
  CrmAuditLogSchema,
} from '../audit-logs/schemas/crm-audit-log.schema';
import { CareLog, CareLogSchema } from '../care-logs/schemas/care-log.schema';
import {
  CrmAttachment,
  CrmAttachmentSchema,
} from '../care-logs/schemas/crm-attachment.schema';
import {
  CareTeamRequest,
  CareTeamRequestSchema,
} from '../care-teams/schemas/care-team-request.schema';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { CrmCommonModule } from '../common/crm-common.module';
import { PiiCryptoModule } from '../common/crypto/pii-crypto.module';
import { CrmSecurityModule } from '../common/security/crm-security.module';
import { CrmSettingsModule } from '../crm-settings/crm-settings.module';
import { RemindersCoreModule } from '../reminders/reminders-core.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  Notification,
  NotificationSchema,
} from '../../notifications/schemas/notification.schema';
import { ProjectsModule } from '../projects/projects.module';
import { Tag, TagSchema } from '../tags/schemas/tag.schema';
import { CustomerAccessService } from './access/customer-access.service';
import { CustomerCareAnonymizerService } from './customer-care-anonymizer.service';
import { CustomerCriteriaService } from './customer-criteria.service';
import { CustomerHistoriesController } from './customer-histories.controller';
import { CustomerHistoriesService } from './customer-histories.service';
import { CustomerLifecycleController } from './customer-lifecycle.controller';
import { CustomerLifecycleService } from './customer-lifecycle.service';
import { CustomerListService } from './customer-list.service';
import { CustomerPersonaAnonymizerService } from './customer-persona-anonymizer.service';
import { CustomerSchedulingAnonymizerService } from './customer-scheduling-anonymizer.service';
import { CustomerNationalIdService } from './customer-national-id.service';
import { CustomerPhoneService } from './customer-phone.service';
import { CustomerRefsService } from './customer-refs.service';
import { CustomerSensitiveDataController } from './customer-sensitive-data.controller';
import { CustomerStatusChangeService } from './customer-status-change.service';
import { CustomerTagsService } from './customer-tags.service';
import { CustomerTeamSyncModule } from './customer-team-sync.module';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import { Customer, CustomerSchema } from './schemas/customer.schema';

/** Khách hàng lõi (M2): hồ sơ, tra/xem SĐT, CCCD, tình trạng, tiêu chí, đồng ý dữ liệu, vòng đời, lịch sử. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: User.name, schema: UserSchema },
      { name: CrmAuditLog.name, schema: CrmAuditLogSchema },
      // Đề nghị tham gia nhóm (`hasPendingRequest`) và dữ liệu chăm sóc cần ẩn danh hóa cùng khách (M3).
      { name: CareTeamRequest.name, schema: CareTeamRequestSchema },
      { name: CareLog.name, schema: CareLogSchema },
      { name: CrmAttachment.name, schema: CrmAttachmentSchema },
      // Thẻ gắn cho khách (M4): kiểm thẻ còn hoạt động, dịch nhãn, giữ `usageCount`, dọn khi ẩn danh hóa.
      { name: Tag.name, schema: TagSchema },
      // Thông báo gắn với khách bị xóa khi ẩn danh hóa (M5).
      { name: Notification.name, schema: NotificationSchema },
    ]),
    // Model danh mục/dự án (CustomerStatus, CatalogItem, Area, Project) để dịch nhãn và khóa ghi.
    CatalogsModule,
    ProjectsModule,
    CrmCommonModule,
    CrmAuditLogModule,
    CrmSecurityModule,
    CrmSettingsModule,
    PiiCryptoModule,
    RedisModule,
    CustomerTeamSyncModule,
    // Hủy/dựng lại nhắc việc khi xóa mềm/khôi phục và ẩn danh hóa khách (M5).
    RemindersCoreModule,
    NotificationsModule,
  ],
  controllers: [
    CustomersController,
    CustomerSensitiveDataController,
    CustomerLifecycleController,
    CustomerHistoriesController,
  ],
  providers: [
    IdempotencyService,
    CustomersRepository,
    CustomerAccessService,
    CustomerRefsService,
    CustomersService,
    CustomerListService,
    CustomerPhoneService,
    CustomerStatusChangeService,
    CustomerCriteriaService,
    CustomerNationalIdService,
    CustomerLifecycleService,
    CustomerHistoriesService,
    CustomerCareAnonymizerService,
    CustomerTagsService,
    CustomerPersonaAnonymizerService,
    CustomerSchedulingAnonymizerService,
  ],
  exports: [
    CustomersRepository,
    CustomerAccessService,
    CustomerRefsService,
    CustomerStatusChangeService,
    CustomerTagsService,
  ],
})
export class CustomersModule {}
