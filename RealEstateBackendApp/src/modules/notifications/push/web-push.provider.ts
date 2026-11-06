import { Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { NotificationPushStatus } from '../notification.constants';
import { hashPushEndpoint } from './push-endpoint-hash.util';
import {
  PushPayload,
  PushProvider,
  PushSendOptions,
  PushSendOutcome,
  PushSendResult,
  PushSubscriptionTarget,
} from './push-provider.interface';

/** Thời gian chờ tối đa mỗi lần gọi dịch vụ push (Architecture 5.4: `timeout: 5000`). */
export const WEB_PUSH_TIMEOUT_MS = 5000;
/** Payload phải NHỎ HƠN 1 KB (byte, sau khi JSON hóa), đúng Architecture 5.4. */
export const WEB_PUSH_MAX_PAYLOAD_BYTES = 1024;
/** Web Push `Topic`: tối đa 32 ký tự thuộc bộ base64url. */
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Khóa VAPID đã được factory kiểm tra hợp lệ. */
export interface WebPushVapidConfig {
  /** `mailto:` hoặc `https:`. */
  subject: string;
  publicKey: string;
  /** Bí mật: chỉ truyền cho thư viện, không bao giờ ghi log. */
  privateKey: string;
}

/** Phần thư viện `web-push` mà provider dùng (để test thay bằng bản giả). */
export type WebPushSender = Pick<typeof webpush, 'sendNotification'>;

/** Lỗi nội bộ: hết hạn chờ tổng (socket timeout của thư viện chỉ đo thời gian rảnh, không đo tổng). */
class PushDeadlineError extends Error {
  constructor() {
    super('push deadline exceeded');
    this.name = 'PushDeadlineError';
  }
}

/**
 * Ánh xạ mã HTTP của dịch vụ push sang kết quả (Architecture 5.4, FR-02):
 * 2xx `SENT`; 404/410 `GONE`; 400/401/403/413 `PERMANENT`; 408/429/5xx `TRANSIENT`.
 * Mã còn lại (3xx redirect, 4xx khác, 1xx) là `PERMANENT`: thử lại không đổi được kết quả.
 */
export function classifyPushStatus(statusCode: number): PushSendOutcome {
  if (statusCode >= 200 && statusCode < 300) return 'SENT';
  if (statusCode === 404 || statusCode === 410) return 'GONE';
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
    return 'TRANSIENT';
  }
  return 'PERMANENT';
}

/** Endpoint phải là URL `https:` và có đủ hai khóa mã hóa (thiếu khóa thì không mã hóa được payload). */
function isValidSubscription(
  subscription: PushSubscriptionTarget | undefined,
): subscription is PushSubscriptionTarget {
  if (!subscription) return false;
  const { endpoint, keys } = subscription;
  if (typeof endpoint !== 'string' || !keys) return false;
  if (!keys.p256dh || !keys.auth) return false;
  try {
    return new URL(endpoint).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * JSON hóa payload với đúng 5 trường cố định (không bao giờ nhét thêm dữ liệu vào payload). Trả `null` khi payload
 * thiếu (undefined/null/không phải object) hoặc không JSON hóa được, để `send` trả `PERMANENT` thay vì ném lỗi.
 */
function serializePayload(
  payload: PushPayload | undefined | null,
): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  try {
    return JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      type: payload.type,
    });
  } catch {
    return null;
  }
}

/** `WebPushError` của thư viện mang `statusCode` + `headers`; nhận diện theo hình dạng (không phụ thuộc class). */
function hasHttpStatus(
  error: unknown,
): error is { statusCode: number; headers?: Record<string, string> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  );
}

/**
 * Gửi Web Push thật bằng thư viện `web-push` (VAPID, nội dung mã hóa `aes128gcm`).
 *
 * - Không dùng `setVapidDetails` toàn cục: khóa truyền theo từng lần gọi, không có trạng thái chung.
 * - Thư viện dùng `https.request` trực tiếp và KHÔNG theo redirect: 3xx coi là lỗi `PERMANENT`
 *   (không đuổi theo sang host khác).
 * - Không bao giờ ném lỗi ra ngoài; không ghi log khóa riêng, `endpoint` thô hay nội dung payload.
 */
export class WebPushProvider implements PushProvider {
  readonly name = 'web-push';
  private readonly logger = new Logger(WebPushProvider.name);

  constructor(
    private readonly vapid: WebPushVapidConfig,
    private readonly featureFlags: FeatureFlagService,
    private readonly sender: WebPushSender = webpush,
  ) {}

  /** Kiểm lại cờ mỗi lần gọi (Architecture 5.4, L6): cờ bị tắt thì mọi thông báo mới là `SKIPPED`. */
  isEnabled(): boolean {
    return this.featureFlags.isEnabled(FeatureFlag.CRM_PUSH);
  }

  initialStatus(): NotificationPushStatus {
    return this.isEnabled()
      ? NotificationPushStatus.PENDING
      : NotificationPushStatus.SKIPPED;
  }

  /**
   * Luồng: kiểm tra trước khi gửi (endpoint https, đủ khóa, payload < 1 KB) -> gọi thư viện với
   * timeout 5 giây -> phân loại kết quả. Lỗi kiểm tra trả `PERMANENT` mà không gọi mạng.
   */
  async send(
    subscription: PushSubscriptionTarget,
    payload: PushPayload,
    options: PushSendOptions,
  ): Promise<PushSendResult> {
    const endpointHash = hashPushEndpoint(subscription?.endpoint);

    if (!isValidSubscription(subscription)) {
      this.logger.error(
        `Push bỏ qua: subscription sai định dạng (endpointHash=${endpointHash})`,
      );
      return { outcome: 'PERMANENT' };
    }

    const body = serializePayload(payload);
    if (body === null) {
      this.logger.error(
        `Push bỏ qua: payload không hợp lệ (endpointHash=${endpointHash})`,
      );
      return { outcome: 'PERMANENT' };
    }
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes >= WEB_PUSH_MAX_PAYLOAD_BYTES) {
      this.logger.error(
        `Push bỏ qua: payload ${bytes} byte vượt giới hạn ${WEB_PUSH_MAX_PAYLOAD_BYTES} (endpointHash=${endpointHash})`,
      );
      return { outcome: 'PERMANENT' };
    }

    try {
      const response = await this.sendWithDeadline(
        subscription,
        body,
        this.buildRequestOptions(options, endpointHash),
      );
      return this.toResult(classifyPushStatus(response.statusCode), {
        statusCode: response.statusCode,
        endpointHash,
      });
    } catch (error) {
      return this.fromError(error, endpointHash);
    }
  }

  private buildRequestOptions(
    options: PushSendOptions,
    endpointHash: string,
  ): webpush.RequestOptions {
    const requestOptions: webpush.RequestOptions = {
      vapidDetails: {
        subject: this.vapid.subject,
        publicKey: this.vapid.publicKey,
        privateKey: this.vapid.privateKey,
      },
      timeout: WEB_PUSH_TIMEOUT_MS,
      TTL: Math.max(0, Math.floor(options.ttlSeconds)),
      urgency: options.urgency,
      contentEncoding: 'aes128gcm',
    };
    if (options.topic !== undefined) {
      if (TOPIC_PATTERN.test(options.topic)) {
        requestOptions.topic = options.topic;
      } else {
        // Sai topic chỉ mất khả năng thay thế bản trùng, không đáng làm hỏng cả lần gửi.
        this.logger.warn(
          `Push bỏ topic sai định dạng (endpointHash=${endpointHash})`,
        );
      }
    }
    return requestOptions;
  }

  /**
   * `timeout` của thư viện chỉ là socket idle timeout; đặt thêm hạn chót tổng 5 giây bằng `Promise.race`
   * để một dịch vụ push nhỏ giọt từng gói tin không giữ worker quá lâu.
   */
  private async sendWithDeadline(
    subscription: PushSubscriptionTarget,
    body: string,
    requestOptions: webpush.RequestOptions,
  ): Promise<webpush.SendResult> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PushDeadlineError()),
        WEB_PUSH_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([
        this.sender.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          body,
          requestOptions,
        ),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Lỗi có `statusCode` là phản hồi của dịch vụ push; còn lại (timeout, ECONNRESET...) là lỗi tạm. */
  private fromError(error: unknown, endpointHash: string): PushSendResult {
    if (hasHttpStatus(error)) {
      return this.toResult(classifyPushStatus(error.statusCode), {
        statusCode: error.statusCode,
        endpointHash,
        retryAfter: error.headers?.['retry-after'],
      });
    }
    // Không ghi `error.message` (có thể chứa endpoint); chỉ tên lỗi hoặc mã lỗi mạng.
    const code =
      error instanceof Error
        ? ((error as NodeJS.ErrnoException).code ?? error.name)
        : 'unknown';
    this.logger.warn(
      `Push lỗi tạm (không có phản hồi): ${code} (endpointHash=${endpointHash})`,
    );
    return { outcome: 'TRANSIENT' };
  }

  private toResult(
    outcome: PushSendOutcome,
    info: { statusCode: number; endpointHash: string; retryAfter?: string },
  ): PushSendResult {
    if (outcome === 'PERMANENT') {
      this.logger.error(
        `Push thất bại vĩnh viễn: HTTP ${info.statusCode} (endpointHash=${info.endpointHash})`,
      );
    } else if (outcome === 'TRANSIENT') {
      // `Retry-After` chỉ để ghi log; nhịp thử lại do backoff của BullMQ quyết định.
      const retry = info.retryAfter ? `, Retry-After=${info.retryAfter}` : '';
      this.logger.warn(
        `Push lỗi tạm: HTTP ${info.statusCode}${retry} (endpointHash=${info.endpointHash})`,
      );
    }
    return { outcome, statusCode: info.statusCode };
  }
}
