import { Injectable } from '@nestjs/common';
import { NotificationPushStatus } from '../notification.constants';
import { PushProvider, PushSendResult } from './push-provider.interface';

/**
 * Nhà cung cấp rỗng: dùng khi cờ `FEATURE_CRM_PUSH` tắt hoặc thiếu `VAPID_*`. Không gửi gì,
 * thông báo chỉ nằm trong hộp thông báo trong app (`pushStatus = SKIPPED`).
 */
@Injectable()
export class NoopPushProvider implements PushProvider {
  readonly name = 'noop';

  isEnabled(): boolean {
    return false;
  }

  initialStatus(): NotificationPushStatus {
    return NotificationPushStatus.SKIPPED;
  }

  /**
   * Worker luôn kiểm `isEnabled()` trước nên không bao giờ tới đây; nếu lỡ gọi thì trả `PERMANENT`
   * (thử lại cũng không có gì để gửi) thay vì ném lỗi hay giả vờ thành công.
   */
  send(): Promise<PushSendResult> {
    return Promise.resolve({ outcome: 'PERMANENT' });
  }
}
