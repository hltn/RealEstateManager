import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  checkHealth() {
    const dbStatus =
      this.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    return {
      status: 'OK',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
