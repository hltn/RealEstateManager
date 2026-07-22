import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsFireCrawlManagerController } from './news-fire-crawl-manager.controller';
import { NewsSourceController } from './controllers/news-source.controller';
import { FirecrawlService } from './services/firecrawl.service';
import { AIFilterService } from './services/ai-filter.service';
import { NewsArticleService } from './services/news-article.service';
import { WordPressService } from './services/wordpress.service';
import { CronjobService } from './services/cronjob.service';
import { NewsSourceService } from './services/news-source.service';
import { NewsArticle, NewsArticleSchema } from './schemas/news-article.schema';
import { NewsSource, NewsSourceSchema } from './schemas/news-source.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NewsArticle.name, schema: NewsArticleSchema },
      { name: NewsSource.name, schema: NewsSourceSchema },
    ]),
  ],
  controllers: [
    NewsFireCrawlManagerController,
    NewsSourceController,
  ],
  providers: [
    FirecrawlService,
    AIFilterService,
    NewsArticleService,
    WordPressService,
    CronjobService,
    NewsSourceService,
  ],
})
export class NewsFireCrawlManagerModule {}
