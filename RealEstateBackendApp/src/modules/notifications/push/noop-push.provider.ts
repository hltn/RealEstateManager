import { Injectable } from '@nestjs/common';
import { NotificationPushStatus } from '../notification.constants';
import { PushProvider } from './push-provider.interface';

/** Giai đoạn 1 chưa có FCM (M7): không gửi gì, thông báo chỉ nằm trong hộp thông báo trong app. */
@Injectable()
export class NoopPushProvider implements PushProvider {
  readonly name = 'noop';

  isEnabled(): boolean {
    return false;
  }

  initialStatus(): NotificationPushStatus {
    return NotificationPushStatus.SKIPPED;
  }
}
