import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { CareLog, CareLogSchema } from '../care-logs/schemas/care-log.schema';
import { RemindersWriterService } from './reminders-writer.service';
import { Reminder, ReminderSchema } from './schemas/reminder.schema';

/**
 * Phần "ghi nhắc việc" của M5, KHÔNG phụ thuộc module khách/lịch hẹn/nhật ký nên module nào cũng import được
 * (khách: dọn khi xóa mềm/ẩn danh hóa; lịch hẹn, nhật ký: đồng bộ khi ghi) mà không tạo vòng phụ thuộc.
 * Phần gửi nhắc (dispatch, quét, lịch chạy) ở `RemindersModule`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reminder.name, schema: ReminderSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: CareLog.name, schema: CareLogSchema },
    ]),
  ],
  providers: [RemindersWriterService],
  exports: [RemindersWriterService, MongooseModule],
})
export class RemindersCoreModule {}
