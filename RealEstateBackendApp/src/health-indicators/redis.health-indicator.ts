import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { withTimeout } from '../common/utils/with-timeout.util';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';

const REDIS_PING_TIMEOUT_MS = 3000;

/** Readiness: Redis phải trả PONG trong 3 giây. Không đưa chi tiết lỗi nội bộ vào response. */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.indicatorService.check(key);
    try {
      const reply = await withTimeout(this.redis.ping(), REDIS_PING_TIMEOUT_MS);
      return reply === 'PONG'
        ? indicator.up()
        : indicator.down({ message: 'Redis phản hồi không hợp lệ' });
    } catch {
      return indicator.down({ message: 'Không kết nối được Redis' });
    }
  }
}
