import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { FeatureFlagService } from '../../shared/feature-flags/feature-flag.service';
import { PiiCryptoModule } from '../crm/common/crypto/pii-crypto.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { createPushProvider } from './push/push-provider.factory';
import {
  PUSH_THROTTLER_MODULE_OPTIONS,
  PUSH_THROTTLER_OPTIONS,
  PUSH_THROTTLER_STORAGE,
  PushRegistrationThrottlerGuard,
} from './push/push-registration-throttler.guard';
import { PushSubscriptionsController } from './push/push-subscriptions.controller';
import { PushSubscriptionsService } from './push/push-subscriptions.service';
import {
  PushSubscription,
  PushSubscriptionSchema,
} from './push/schemas/push-subscription.schema';
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
 * thông báo, điểm ghi thông báo cho module khác (`NotificationsService.createMany`) và cổng push (`WebPushProvider` khi bật cờ + đủ `VAPID_*`, ngược lại Noop).
 * Không phụ thuộc module CRM nào nên module CRM nào cũng import được mà không tạo vòng.
 * `PUSH_PROVIDER` do `createPushProvider` chọn một lần lúc khởi động (Architecture 5.4).
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
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
    ]),
    // Mã hóa `auth` của push_subscriptions (T-26).
    PiiCryptoModule,
  ],
  controllers: [
    NotificationsController,
    NotificationPreferencesController,
    PushSubscriptionsController,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    PushSubscriptionsService,
    // Throttler đăng ký push tự chứa cấu hình + kho đếm, không phụ thuộc ThrottlerModule toàn cục.
    {
      provide: PUSH_THROTTLER_OPTIONS,
      useValue: PUSH_THROTTLER_MODULE_OPTIONS,
    },
    { provide: PUSH_THROTTLER_STORAGE, useClass: ThrottlerStorageService },
    PushRegistrationThrottlerGuard,
    {
      provide: PUSH_PROVIDER,
      useFactory: createPushProvider,
      inject: [ConfigService, FeatureFlagService],
    },
  ],
  exports: [NotificationsService, PushSubscriptionsService],
})
export class NotificationsModule {}
