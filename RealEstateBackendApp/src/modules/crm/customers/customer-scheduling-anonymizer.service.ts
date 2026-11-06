import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from '../../notifications/schemas/notification.schema';
import {
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import { RemindersWriterService } from '../reminders/reminders-writer.service';
import { ANONYMIZED_PLACEHOLDER } from './customer.constants';

/**
 * Ẩn danh hóa lịch hẹn, nhắc việc và thông báo của một khách (M5), chạy trong CÙNG transaction với việc ẩn danh hóa
 * hồ sơ (cùng mẫu `CustomerCareAnonymizerService`):
 * - lịch hẹn: ghi đè tiêu đề, ghi chú, địa điểm, kết quả (văn bản tự do, có thể có PII); giữ loại, giờ, trạng thái,
 *   người thực hiện cho thống kê;
 * - nhắc việc chưa gửi: hủy (bản ghi chỉ chứa id nên không cần xóa);
 * - thông báo trong hộp thông báo của mọi người: XÓA CẢ BẢN GHI (tiêu đề/nội dung và `push` dựng sẵn đều có tên
 *   khách, FR-06); là dữ liệu tạm có TTL. Job `push.send` đang chờ gặp bản ghi đã mất thì dừng, không gửi gì.
 */
@Injectable()
export class CustomerSchedulingAnonymizerService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly reminders: RemindersWriterService,
  ) {}

  async anonymize(
    customerId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    await this.appointmentModel
      .updateMany(
        { customerId },
        [
          {
            $set: {
              title: ANONYMIZED_PLACEHOLDER,
              note: ANONYMIZED_PLACEHOLDER,
              location: '',
              outcome: {
                $cond: [
                  { $eq: [{ $type: '$outcome' }, 'string'] },
                  ANONYMIZED_PLACEHOLDER,
                  null,
                ],
              },
            },
          },
        ],
        { session, timestamps: false, updatePipeline: true },
      )
      .exec();
    await this.reminders.cancelForCustomer(customerId, now, session);
    // Xóa cả bản ghi nên `notifications.push` (nội dung push có tên khách) cũng mất; không để lại bản có `push`.
    await this.notificationModel
      .deleteMany({ 'data.customerId': customerId }, { session })
      .exec();
  }
}
