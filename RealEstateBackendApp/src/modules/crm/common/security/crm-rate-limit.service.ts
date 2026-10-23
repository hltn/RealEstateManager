import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../../common/exceptions/error-codes';
import { REDIS_CLIENT } from '../../../../shared/redis/redis.constants';

/** Giới hạn theo NGƯỜI DÙNG (tài liệu 04 mục 7.3): xác định sau khi đã xác thực, khác Throttler theo IP. */
export const RATE_LIMITS = {
  /** `phone-lookups`: 30 lần/phút/người. */
  PHONE_LOOKUP: { limit: 30, windowMs: 60_000 },
  /** `phone-views`: 60 lần/phút/người. */
  PHONE_VIEW: { limit: 60, windowMs: 60_000 },
  /** `national-id-views`: 10 lần/phút/người. */
  NATIONAL_ID_VIEW: { limit: 10, windowMs: 60_000 },
  /** Tìm kiếm danh sách (có từ khóa): 30 lần/phút/người. */
  CUSTOMER_SEARCH: { limit: 30, windowMs: 60_000 },
  /** Tải ảnh đính kèm nhật ký: 30 lần/phút/người (chống đầy kho lưu trữ). */
  ATTACHMENT_UPLOAD: { limit: 30, windowMs: 60_000 },
  /** Thao tác hàng loạt (mỗi lần tới 200 khách): 10 lần/phút/người. */
  BULK_OPERATION: { limit: 10, windowMs: 60_000 },
  /** Đề nghị tham gia nhóm chăm sóc: 20 lần/phút/người (chống spam người duyệt). */
  JOIN_REQUEST: { limit: 20, windowMs: 60_000 },
} as const;

/** Cửa sổ gộp lượt tìm kiếm trùng từ khóa (list + list-counts + đổi trang). */
const DEDUPE_WINDOW_MS = 5000;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Tăng bộ đếm và đặt hạn ở lần đầu trong cùng một lệnh nguyên tử; trả [count, ttlMs còn lại]. */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

/**
 * Rate limit cửa sổ cố định theo người dùng + loại thao tác, lưu trên Redis (stateless, dùng được nhiều instance).
 *
 * Vượt ngưỡng => 429 `RATE_LIMITED { retryAfterSeconds }`. Redis lỗi => 503 (thà từ chối còn hơn bỏ giới hạn
 * bảo vệ dữ liệu cá nhân — cùng triết lý với `IdempotencyService`).
 */
@Injectable()
export class CrmRateLimitService {
  private readonly logger = new Logger(CrmRateLimitService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Như `consume` nhưng gộp các lần gọi CÙNG `token` của cùng người trong `dedupeMs`: chỉ lần đầu tốn lượt.
   * Dùng cho "một lần tìm" của giao diện gọi đồng thời `list` + `list-counts` (cùng từ khóa) hoặc đổi trang —
   * dò số cần ĐỔI từ khóa nên vẫn bị đếm đầy đủ. Redis lỗi => 503 như `consume`.
   */
  async consumeDeduped(
    userId: string,
    bucket: RateLimitBucket,
    token: string,
    dedupeMs = DEDUPE_WINDOW_MS,
  ): Promise<void> {
    const digest = createHash('sha256').update(token).digest('hex');
    let isFirst: boolean;
    try {
      isFirst =
        (await this.redis.set(
          `crm:rl:dedupe:${bucket}:${userId}:${digest}`,
          '1',
          'PX',
          dedupeMs,
          'NX',
        )) === 'OK';
    } catch (error) {
      this.logger.error(
        `Rate limit ${bucket} (dedupe) không kiểm tra được: ${(error as Error).message}`,
      );
      throw this.unavailable();
    }
    if (isFirst) await this.consume(userId, bucket);
  }

  async consume(userId: string, bucket: RateLimitBucket): Promise<void> {
    const { limit, windowMs } = RATE_LIMITS[bucket];
    let count: number;
    let ttlMs: number;
    try {
      [count, ttlMs] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        1,
        `crm:rl:${bucket}:${userId}`,
        windowMs,
      )) as [number, number];
    } catch (error) {
      this.logger.error(
        `Rate limit ${bucket} không kiểm tra được: ${(error as Error).message}`,
      );
      throw this.unavailable();
    }
    if (count > limit) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        'Bạn thao tác quá nhanh, vui lòng thử lại sau',
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) },
      );
    }
  }

  private unavailable(): BusinessException {
    return new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
