import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueRuntimeModule } from '../../../shared/queue/queue-runtime.module';
import { RedisModule } from '../../../shared/redis/redis.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { CareLogsModule } from '../care-logs/care-logs.module';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { CrmSettingsModule } from '../crm-settings/crm-settings.module';
import { CustomersModule } from '../customers/customers.module';
import {
  PersonaField,
  PersonaFieldSchema,
} from '../persona/schemas/persona-field.schema';
import { CrmSchedulerService } from './crm-scheduler.service';
import { ReminderDispatchService } from './reminder-dispatch.service';
import { ReminderScannerService } from './reminder-scanner.service';
import { RemindersCoreModule } from './reminders-core.module';

/**
 * Gửi nhắc việc + quét định kỳ + lịch chạy BullMQ (M5, tài liệu 04 mục 2.3 `crm/reminders`; không có controller).
 * Phần ghi/hủy nhắc nằm ở `RemindersCoreModule`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PersonaField.name, schema: PersonaFieldSchema },
    ]),
    RemindersCoreModule,
    CustomersModule,
    CatalogsModule,
    CareLogsModule,
    NotificationsModule,
    CrmSettingsModule,
    QueueRuntimeModule,
    RedisModule,
  ],
  providers: [
    ReminderDispatchService,
    ReminderScannerService,
    CrmSchedulerService,
  ],
  exports: [
    ReminderDispatchService,
    ReminderScannerService,
    CrmSchedulerService,
  ],
})
export class RemindersModule {}
