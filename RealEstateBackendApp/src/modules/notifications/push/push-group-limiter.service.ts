import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';

/** Tối đa 3 push cho mỗi (người nhận, đợt hàng loạt) (Architecture 5.5, Q5). */
export const PUSH_GROUP_MAX_PER_USER = 3;
/** Bộ đếm và dấu quyết định tự hết hạn sau 10 phút (một đợt hàng loạt dài hơn vài giây là rất hiếm). */
export const PUSH_GROUP_TTL_SECONDS = 10 * 60;

/**
 * Lua chạy nguyên tử trên Redis, IDEMPOTENT theo từng thông báo:
 * - KEYS[1] = bộ đếm `push:group:{userId}:{groupKey}`; KEYS[2] = dấu quyết định của đúng thông báo này
 *   (`{bộ đếm}:n:{notificationId}`).
 * - Thông báo đã có dấu (job retry, hoặc chạy trùng) thì trả lại đúng quyết định cũ, KHÔNG tăng bộ đếm lần nữa.
 * - Chưa có dấu: `INCR` bộ đếm (đặt hạn ở lần đầu, hoặc khi bộ đếm lỡ mất hạn), cho phép khi `<= giới hạn`, rồi ghi
 *   dấu quyết định cùng hạn. Trả 1 = được gửi, 0 = vượt hạn mức.
 */
const GROUP_LIMIT_SCRIPT = `
local decided = redis.call('GET', KEYS[2])
if decided then return tonumber(decided) end
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local allowed = 0
if count <= tonumber(ARGV[1]) then allowed = 1 end
redis.call('SET', KEYS[2], allowed, 'EX', ARGV[2])
return allowed
`;

/**
 * Giới hạn "bão push" cho thao tác thêm hàng loạt (FR-43, Q5; Architecture 5.5): mỗi (người nhận, đợt) tối đa
 * `PUSH_GROUP_MAX_PER_USER` push; phần vượt do worker đặt `SKIPPED` (thông báo vẫn nằm trong hộp thông báo).
 *
 * Fail-open: Redis lỗi thì CHO PHÉP gửi (log cảnh báo). Lý do: push nằm sau commit, giới hạn chỉ là tối ưu chống
 * ồn; chặn nhầm là mất thông báo thật, còn gửi thừa chỉ là ồn tạm thời. Không bao giờ ném lỗi ra nghiệp vụ/job.
 */
@Injectable()
export class PushGroupLimiter {
  private readonly logger = new Logger(PushGroupLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * `true` nếu thông báo này được phép gửi push. `groupKey` rỗng (không thuộc đợt hàng loạt) thì không giới hạn.
   * Log không ghi `groupKey` (chứa `X-Request-ID`) hay tên khách, chỉ `notificationId`.
   */
  async tryAcquire(
    userId: string,
    groupKey: string | null | undefined,
    notificationId: string,
  ): Promise<boolean> {
    if (!groupKey) return true;
    const counterKey = `push:group:${userId}:${groupKey}`;
    try {
      const allowed = await this.redis.eval(
        GROUP_LIMIT_SCRIPT,
        2,
        counterKey,
        `${counterKey}:n:${notificationId}`,
        PUSH_GROUP_MAX_PER_USER,
        PUSH_GROUP_TTL_SECONDS,
      );
      return Number(allowed) === 1;
    } catch (error) {
      this.logger.warn(
        `push.send notificationId=${notificationId} giới hạn đợt không kiểm tra được, vẫn gửi: ${(error as Error).message}`,
      );
      return true;
    }
  }
}
