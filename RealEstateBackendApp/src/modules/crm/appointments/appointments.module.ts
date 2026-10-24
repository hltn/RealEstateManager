import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { RedisModule } from '../../../shared/redis/redis.module';
import { CareLogsModule } from '../care-logs/care-logs.module';
import { CareLog, CareLogSchema } from '../care-logs/schemas/care-log.schema';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { CrmSettingsModule } from '../crm-settings/crm-settings.module';
import { CustomersModule } from '../customers/customers.module';
import {
  PersonaField,
  PersonaFieldSchema,
} from '../persona/schemas/persona-field.schema';
import { AppointmentsCoreModule } from './appointments-core.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { DailyTasksController } from './daily-tasks.controller';
import { DailyTasksService } from './daily-tasks.service';

/** Lịch hẹn + việc hôm nay (M5, tài liệu 04 mục 2.3 `crm/appointments`). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CareLog.name, schema: CareLogSchema },
      { name: PersonaField.name, schema: PersonaFieldSchema },
    ]),
    AppointmentsCoreModule,
    CareLogsModule,
    CatalogsModule,
    CustomersModule,
    CrmSettingsModule,
    RedisModule,
  ],
  controllers: [AppointmentsController, DailyTasksController],
  providers: [IdempotencyService, AppointmentsService, DailyTasksService],
})
export class AppointmentsModule {}
