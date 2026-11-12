import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { NoopPushProvider } from './noop-push.provider';
import { PushProvider } from './push-provider.interface';
import { WebPushProvider, WebPushVapidConfig } from './web-push.provider';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Khóa công khai VAPID (điểm P-256 chưa nén) dài 65 byte, khóa riêng 32 byte. */
const VAPID_PUBLIC_KEY_BYTES = 65;
const VAPID_PRIVATE_KEY_BYTES = 32;

function isValidSubject(subject: string): boolean {
  try {
    const { protocol } = new URL(subject);
    return protocol === 'mailto:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidKey(value: string, expectedBytes: number): boolean {
  return (
    BASE64URL_PATTERN.test(value) &&
    Buffer.from(value, 'base64url').length === expectedBytes
  );
}

/**
 * Trả về tên các biến `VAPID_*` thiếu hoặc sai định dạng (rỗng = hợp lệ). Chỉ trả TÊN biến,
 * không bao giờ trả hay ghi giá trị (khóa riêng là bí mật).
 */
function findInvalidVapidVars(vapid: WebPushVapidConfig): string[] {
  const invalid: string[] = [];
  if (!isValidSubject(vapid.subject)) invalid.push('VAPID_SUBJECT');
  if (!isValidKey(vapid.publicKey, VAPID_PUBLIC_KEY_BYTES)) {
    invalid.push('VAPID_PUBLIC_KEY');
  }
  if (!isValidKey(vapid.privateKey, VAPID_PRIVATE_KEY_BYTES)) {
    invalid.push('VAPID_PRIVATE_KEY');
  }
  return invalid;
}

/**
 * Chọn nhà cung cấp push MỘT LẦN lúc khởi động (Architecture 5.4, L6):
 * cờ `FEATURE_CRM_PUSH` bật VÀ đủ `VAPID_*` hợp lệ thì `WebPushProvider`, ngược lại `NoopPushProvider`.
 * Cờ bật nhưng thiếu/sai biến thì log ERROR một lần (tên biến, không kèm giá trị) và vẫn khởi động
 * bình thường với Noop: không bao giờ làm sập app vì cấu hình push.
 * Đổi biến môi trường cần tạo lại container (`docker compose up -d backend`) mới có hiệu lực.
 */
export function createPushProvider(
  config: ConfigService,
  featureFlags: FeatureFlagService,
  logger: Pick<Logger, 'error' | 'log'> = new Logger('PushProviderFactory'),
): PushProvider {
  if (!featureFlags.isEnabled(FeatureFlag.CRM_PUSH)) {
    return new NoopPushProvider();
  }

  const read = (name: string): string =>
    (config.get<string>(name) ?? '').toString().trim();
  const vapid: WebPushVapidConfig = {
    subject: read('VAPID_SUBJECT'),
    publicKey: read('VAPID_PUBLIC_KEY'),
    privateKey: read('VAPID_PRIVATE_KEY'),
  };

  const invalid = findInvalidVapidVars(vapid);
  if (invalid.length > 0) {
    logger.error(
      `FEATURE_CRM_PUSH đang bật nhưng thiếu hoặc sai định dạng: ${invalid.join(', ')}. ` +
        'Quay về NoopPushProvider (push tắt, hộp thông báo trong app vẫn hoạt động).',
    );
    return new NoopPushProvider();
  }

  logger.log('Web Push bật (VAPID hợp lệ), dùng WebPushProvider.');
  return new WebPushProvider(vapid, featureFlags, webpush);
}
