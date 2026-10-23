import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  MongooseHealthIndicator,
  HealthCheck,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { RedisHealthIndicator } from './health-indicators/redis.health-indicator';
import { StorageHealthIndicator } from './health-indicators/storage.health-indicator';

const MONGO_PING_TIMEOUT_MS = 3000;

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
    private redis: RedisHealthIndicator,
    private storage: StorageHealthIndicator,
  ) {}

  @Public()
  @Get('liveness')
  @HealthCheck()
  @ApiOperation({
    summary: 'Check application liveness',
    description:
      'Liveness probe: chỉ cho biết tiến trình còn sống, không kiểm tra dependency.',
  })
  checkLiveness() {
    return this.health.check([]);
  }

  @Public()
  @Get('readiness')
  @HealthCheck()
  @ApiOperation({
    summary: 'Check application readiness (MongoDB, Redis, S3/MinIO)',
    description:
      'Readiness probe: 200 khi MongoDB, Redis và S3/MinIO đều sẵn sàng, 503 khi có thành phần lỗi.',
  })
  checkReadiness() {
    return this.health.check([
      () =>
        this.mongoose.pingCheck('database', { timeout: MONGO_PING_TIMEOUT_MS }),
      () => this.redis.isHealthy('redis'),
      () => this.storage.isHealthy('storage'),
    ]);
  }
}
