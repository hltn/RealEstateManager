import { Module } from '@nestjs/common';
import { NewsFireCrawlManagerController } from './news-fire-crawl-manager.controller';

@Module({
  controllers: [NewsFireCrawlManagerController],
  providers: [],
})
export class NewsFireCrawlManagerModule {}
