import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { CrmAuditLogModule } from '../audit-logs/crm-audit-log.module';
import { CrmSettingsModule } from '../crm-settings/crm-settings.module';
import { CustomersModule } from '../customers/customers.module';
import { RemindersCoreModule } from '../reminders/reminders-core.module';
import { AppointmentsWriteService } from './appointments-write.service';
import { Appointment, AppointmentSchema } from './schemas/appointment.schema';

/**
 * Phần ghi lịch hẹn (không có controller) để `CareLogsModule` tạo lịch từ `nextAction.appointment` mà không phụ thuộc
 * vòng với `AppointmentsModule` (cần `CareLogsModule` cho "hoàn thành kèm nhật ký").
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CustomersModule,
    CrmAuditLogModule,
    CrmSettingsModule,
    RemindersCoreModule,
  ],
  providers: [AppointmentsWriteService],
  exports: [AppointmentsWriteService, MongooseModule],
})
export class AppointmentsCoreModule {}
