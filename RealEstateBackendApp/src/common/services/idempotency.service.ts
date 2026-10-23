import { createHash, randomUUID } from 'crypto';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';

const DEFAULT_RESPONSE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_IN_FLIGHT_TTL_MS = 30 * 60 * 1000;

const RESPONSE_KEY_PREFIX = 'idem:resp:';
const LOCK_KEY_PREFIX = 'idem:lock:';

/** Chỉ xóa khóa khi giá trị vẫn là của instance này (không xóa nhầm khóa của instance khác sau khi TTL hết). */
const COMPARE_AND_DELETE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Đọc số dương từ cấu hình, sai/thiếu thì dùng mặc định. */
function positiveIntOr(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface LockOptions {
  /** TTL riêng cho khóa này (ms). Mặc định lấy `IDEMPOTENCY_INFLIGHT_TTL_MS` (30 phút). */
  ttlMs?: number;
}

/** Phạm vi của một Idempotency-Key: cùng key của 2 người dùng/2 route khác nhau KHÔNG được chung response. */
export interface IdempotencyScope {
  userId: string;
  /** Định danh route, ví dụ `POST /crm/customers`. */
  route: string;
}

/**
 * Ghép key do client gửi với người dùng + route, rồi băm (SHA-256) thành khóa an toàn.
 * Bắt buộc dùng cho mọi endpoint mới (CRM, từ M2) để user B không nhận response đã lưu của
 * user A khi trùng/đoán được `X-Idempotency-Key`. Cách dùng ở controller:
 *
 *   const key = idempotencyHeader
 *     ? buildIdempotencyKey({ userId: user.sub, route: 'POST /crm/customers' }, idempotencyHeader)
 *     : undefined;
 *   return runIdempotent(this.idempotency, key, () => this.service.create(dto), () => {
 *     throw new BusinessException(ErrorCode.IDEMPOTENCY_IN_PROGRESS, '...', HttpStatus.CONFLICT);
 *   });
 */
export function buildIdempotencyKey(
  scope: IdempotencyScope,
  clientKey: string,
): string {
  // Dùng NUL làm dấu phân cách để ('a:b','c') và ('a','b:c') không cho cùng khóa.
  return createHash('sha256')
    .update([scope.userId, scope.route, clientKey].join('\u0000'))
    .digest('hex');
}

/**
 * Idempotency lưu trên Redis (backend stateless, dùng được khi scale nhiều instance).
 *
 * - Response đã xử lý: `SET idem:resp:<key> <json> PX <IDEMPOTENCY_TTL_MS>` (mặc định 5 phút).
 * - Khóa "đang xử lý": `idem:lock:<key>`, giá trị là `bootId` ngẫu nhiên của instance đang giữ,
 *   TTL an toàn `IDEMPOTENCY_INFLIGHT_TTL_MS` (mặc định 30 phút, ghi đè được theo từng khóa).
 *   Job chạy trong RAM của instance, nên:
 *   - khi instance tắt êm, các khóa nó đang giữ được nhả (BeforeApplicationShutdown);
 *   - khi instance chết đột ngột, khóa tự hết hạn theo TTL;
 *   - `clearInFlight` chỉ xóa khóa còn mang bootId của chính instance này.
 *
 * Giữ tên phương thức cũ (get/set/isInFlight/markInFlight/clearInFlight) nhưng nay bất đồng bộ.
 * Code mới dùng `tryMarkInFlight` (SET NX, nguyên tử): cặp `isInFlight` + `markInFlight`
 * có khe race giữa hai lần gọi nên không dùng để chặn double-submit.
 *
 * Lỗi Redis được ném lên (không nuốt): không đảm bảo được tính duy nhất thì không âm thầm cho qua.
 */
@Injectable()
export class IdempotencyService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly responseTtlMs: number;
  private readonly inFlightTtlMs: number;
  /** Định danh ngẫu nhiên của tiến trình này, đổi sau mỗi lần khởi động. */
  private readonly bootId = randomUUID();
  /** Các khóa instance này đang giữ — để nhả khi tắt êm. */
  private readonly heldLocks = new Set<string>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.responseTtlMs = positiveIntOr(
      config.get('IDEMPOTENCY_TTL_MS'),
      DEFAULT_RESPONSE_TTL_MS,
    );
    this.inFlightTtlMs = positiveIntOr(
      config.get('IDEMPOTENCY_INFLIGHT_TTL_MS'),
      DEFAULT_IN_FLIGHT_TTL_MS,
    );
  }

  /** Lấy response đã lưu cho key, `null` nếu chưa có/đã hết hạn. */
  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.redis.get(RESPONSE_KEY_PREFIX + key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  /** Lưu response (JSON-serializable) với TTL cấu hình được. */
  async set(key: string, response: unknown): Promise<void> {
    await this.redis.set(
      RESPONSE_KEY_PREFIX + key,
      JSON.stringify(response ?? null),
      'PX',
      this.responseTtlMs,
    );
  }

  async isInFlight(key: string): Promise<boolean> {
    return (await this.redis.exists(LOCK_KEY_PREFIX + key)) === 1;
  }

  /** Đánh dấu đang xử lý (ghi đè vô điều kiện, hành vi cũ). Ưu tiên dùng `tryMarkInFlight`. */
  async markInFlight(key: string, options: LockOptions = {}): Promise<void> {
    await this.redis.set(
      LOCK_KEY_PREFIX + key,
      this.bootId,
      'PX',
      this.lockTtl(options),
    );
    this.heldLocks.add(key);
  }

  /** Giành khóa nguyên tử: `true` nếu mình là request đầu tiên, `false` nếu đã có người giữ. */
  async tryMarkInFlight(
    key: string,
    options: LockOptions = {},
  ): Promise<boolean> {
    const result = await this.redis.set(
      LOCK_KEY_PREFIX + key,
      this.bootId,
      'PX',
      this.lockTtl(options),
      'NX',
    );
    if (result !== 'OK') return false;
    this.heldLocks.add(key);
    return true;
  }

  /** Nhả khóa nếu còn là của instance này; khóa đã hết hạn/đổi chủ thì để nguyên. */
  async clearInFlight(key: string): Promise<void> {
    this.heldLocks.delete(key);
    await this.redis.eval(
      COMPARE_AND_DELETE_SCRIPT,
      1,
      LOCK_KEY_PREFIX + key,
      this.bootId,
    );
  }

  /** Tắt êm: nhả mọi khóa còn giữ (job nền trong RAM sắp mất cùng tiến trình). Lỗi Redis chỉ cảnh báo. */
  async beforeApplicationShutdown(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.heldLocks].map((key) => this.clearInFlight(key)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(
        `Không nhả được ${failed} khóa idempotency khi tắt; sẽ tự hết hạn theo TTL`,
      );
    }
  }

  private lockTtl(options: LockOptions): number {
    return positiveIntOr(options.ttlMs, this.inFlightTtlMs);
  }
}
