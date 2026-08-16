import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  KnowledgeConfig,
  KnowledgeConfigSchema,
} from './schemas/knowledge-config.schema';
import {
  PipelineLog,
  PipelineLogSchema,
} from './schemas/pipeline-log.schema';
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
import { NewsFireCrawlManagerModule } from '../news-fire-crawl-manager/news-fire-crawl-manager.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KnowledgeConfig.name, schema: KnowledgeConfigSchema },
      { name: PipelineLog.name, schema: PipelineLogSchema },
    ]),
    // Import NewsArticle model + exported IdempotencyService + AuditLogService.
    NewsFireCrawlManagerModule,
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
