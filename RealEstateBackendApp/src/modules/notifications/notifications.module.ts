import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NoopPushProvider } from './push/noop-push.provider';
import { PUSH_PROVIDER } from './push/push-provider.interface';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceSchema,
} from './schemas/notification-preference.schema';

/**
 * Thông báo dùng chung toàn app (M5, tài liệu 04 mục 2.3 `notifications`): hộp thông báo trong ứng dụng, cài đặt
 * thông báo, điểm ghi thông báo cho module khác (`NotificationsService.createMany`) và cổng push (M5: Noop).
 * Không phụ thuộc module CRM nào nên module CRM nào cũng import được mà không tạo vòng.
 * Đổi `PUSH_PROVIDER` sang `FcmPushProvider` ở M7 là đủ để bật push.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      {
        name: NotificationPreference.name,
        schema: NotificationPreferenceSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    { provide: PUSH_PROVIDER, useClass: NoopPushProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
