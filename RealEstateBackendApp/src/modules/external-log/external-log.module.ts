import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ExternalLogController } from './controllers/external-log.controller';
import {
  ExternalRequestLog,
  ExternalRequestLogSchema,
} from './schemas/external-request-log.schema';
import { ExternalLogSanitizerService } from './services/external-log-sanitizer.service';
import { ExternalLogService } from './services/external-log.service';

/**
 * Ghi log tập trung cho mọi outgoing request (crawl + AI).
 * Export ExternalLogService để module khác (news-fire-crawl-manager) inject.
 * Không @Global — import tường minh để lộ rõ dependency graph.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExternalRequestLog.name, schema: ExternalRequestLogSchema },
    ]),
  ],
  controllers: [ExternalLogController],
  providers: [ExternalLogService, ExternalLogSanitizerService],
  exports: [ExternalLogService],
})
export class ExternalLogModule {}
