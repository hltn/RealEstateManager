import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsFireCrawlManagerController } from './news-fire-crawl-manager.controller';
import { NewsSourceController } from './controllers/news-source.controller';
import { CustomCrawlerService } from './services/custom-crawler.service';
import { AIFilterService } from './services/ai-filter.service';
import { NewsArticleService } from './services/news-article.service';
import { WordPressService } from './services/wordpress.service';
import { CronjobService } from './services/cronjob.service';
import { NewsSourceService } from './services/news-source.service';
import { AiPromptConfigService } from './services/ai-prompt-config.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { AuditLogService } from './services/audit-log.service';
import { NewsArticle, NewsArticleSchema } from './schemas/news-article.schema';
import { NewsSource, NewsSourceSchema } from './schemas/news-source.schema';
import { RawArticle, RawArticleSchema } from './schemas/raw-article.schema';
import {
  MarketAnalysisHistory,
  MarketAnalysisHistorySchema,
} from './schemas/market-analysis-history.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NewsArticle.name, schema: NewsArticleSchema },
      { name: NewsSource.name, schema: NewsSourceSchema },
      { name: RawArticle.name, schema: RawArticleSchema },
      { name: MarketAnalysisHistory.name, schema: MarketAnalysisHistorySchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [NewsFireCrawlManagerController, NewsSourceController],
  providers: [
    CustomCrawlerService,
    AIFilterService,
    NewsArticleService,
    WordPressService,
    CronjobService,
    NewsSourceService,
    AiPromptConfigService,
    IdempotencyService,
    RequestContextService,
    AuditLogService,
  ],
})
export class NewsFireCrawlManagerModule {}
