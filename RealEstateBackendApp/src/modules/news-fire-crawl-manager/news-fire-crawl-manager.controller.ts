import { Controller, Get } from '@nestjs/common';

@Controller('news-fire-crawl-manager')
export class NewsFireCrawlManagerController {
  @Get()
  getHello(): string {
    return 'NewsFireCrawlManager is running!';
  }
}
