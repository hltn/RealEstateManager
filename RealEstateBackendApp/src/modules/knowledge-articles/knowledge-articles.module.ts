import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NewsArticle,
  NewsArticleSchema,
} from '../news-fire-crawl-manager/schemas/news-article.schema';
import {
  KnowledgeConfig,
  KnowledgeConfigSchema,
} from './schemas/knowledge-config.schema';
import {
  PipelineLog,
  PipelineLogSchema,
} from './schemas/pipeline-log.schema';
import {
  AuditLog,
  AuditLogSchema,
} from '../news-fire-crawl-manager/schemas/audit-log.schema';
import { KnowledgeArticlesController } from './knowledge-articles.controller';
import { KnowledgeArticleService } from './services/knowledge-article.service';
import { KnowledgeConfigService } from './services/knowledge-config.service';
import { PipelineLogService } from './services/pipeline-log.service';
import { AiWritingService } from './services/ai-writing.service';
import { AiImageService } from './services/ai-image.service';
import { WpClientService } from './services/wp-client.service';
import { PipelineService } from './services/pipeline.service';
import { NlCronService } from './services/nl-cron.service';
import { CategoryRotationService } from './services/category-rotation.service';
import { AuditLogService } from '../news-fire-crawl-manager/services/audit-log.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { RequestContextService } from '../../common/services/request-context.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NewsArticle.name, schema: NewsArticleSchema },
      { name: KnowledgeConfig.name, schema: KnowledgeConfigSchema },
      { name: PipelineLog.name, schema: PipelineLogSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [KnowledgeArticlesController],
  providers: [
    KnowledgeArticleService,
    KnowledgeConfigService,
    PipelineLogService,
    AiWritingService,
    AiImageService,
    WpClientService,
    CategoryRotationService,
    PipelineService,
    NlCronService,
    AuditLogService,
    IdempotencyService,
    RequestContextService,
  ],
  exports: [
    KnowledgeArticleService,
    KnowledgeConfigService,
    PipelineService,
    NlCronService,
    CategoryRotationService,
  ],
})
export class KnowledgeArticlesModule {}
