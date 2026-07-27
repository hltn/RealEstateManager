import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  MongooseHealthIndicator,
  HealthCheck,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
  ) {}

  @Get('liveness')
  @HealthCheck()
  @ApiOperation({
    summary: 'Check application liveness',
    description: 'Check application liveness',
  })
  checkLiveness() {
    return this.health.check([]);
  }

  @Get('readiness')
  @HealthCheck()
  @ApiOperation({
    summary: 'Check application readiness including database',
    description: 'Check application readiness including database',
  })
  checkReadiness() {
    return this.health.check([() => this.mongoose.pingCheck('database')]);
  }
}
