import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { FirecrawlService } from './services/firecrawl.service';
import { AIFilterService } from './services/ai-filter.service';
import { NewsArticleService } from './services/news-article.service';
import { CronjobService } from './services/cronjob.service';

@Controller('news-manager')
export class NewsFireCrawlManagerController {
  private readonly logger = new Logger(NewsFireCrawlManagerController.name);

  constructor(
    private readonly firecrawlService: FirecrawlService,
    private readonly aiFilterService: AIFilterService,
    private readonly newsArticleService: NewsArticleService,
    private readonly cronjobService: CronjobService,
  ) {}

  @Get('cron')
  getCronConfig() {
    return this.cronjobService.getConfig();
  }

  @Post('cron')
  updateCronConfig(@Body() body: { isActive: boolean; frequency: string }) {
    try {
      return this.cronjobService.updateConfig(body.isActive, body.frequency);
    } catch (error: any) {
      this.logger.error('Error updating cron config', error.stack);
      throw new InternalServerErrorException('Failed to update cron config');
    }
  }

  @Post('trigger')
  async triggerManualCrawl() {
    let filePath: string | null = null;
    try {
      this.logger.log('Manual trigger called');
      filePath = await this.firecrawlService.crawlData();
      const top5Articles = await this.aiFilterService.filterAndRank(filePath);

      return {
        message: 'Crawl and AI filtering completed successfully',
        data: top5Articles,
      };
    } catch (error: any) {
      this.logger.error('Error in manual trigger', error.stack);
      throw new InternalServerErrorException(
        'Failed to process crawl and filter',
      );
    } finally {
      if (filePath) {
        import('fs').then(fs => {
          fs.promises.unlink(filePath!).catch(err => 
            this.logger.error(`Failed to delete temp file ${filePath}`, err.stack)
          );
        });
      }
    }
  }

  @Post('articles/save')
  async saveArticles(@Body() articles: any[]) {
    try {
      if (!Array.isArray(articles) || articles.length === 0) {
        return { message: 'No articles to save' };
      }
      const result = await this.newsArticleService.saveArticles(articles);
      return {
        message: 'Articles processed',
        ...result,
      };
    } catch (error: any) {
      this.logger.error('Error saving articles', error.stack);
      throw new InternalServerErrorException('Failed to save articles');
    }
  }

  @Get('articles')
  async getArticles() {
    try {
      const articles = await this.newsArticleService.getSavedArticles();
      return {
        message: 'Articles fetched successfully',
        data: articles,
      };
    } catch (error: any) {
      this.logger.error('Error fetching articles', error.stack);
      throw new InternalServerErrorException('Failed to fetch articles');
    }
  }

  @Post('articles/publish-bulk')
  async publishBulkArticles(@Body('ids') ids: string[]) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { message: 'No articles to publish' };
      }
      
      const results = await Promise.all(
        ids.map(id => this.newsArticleService.publishToWordPress(id))
      );
      
      return {
        message: 'Articles published to WordPress successfully',
        data: results,
      };
    } catch (error: any) {
      this.logger.error(`Error bulk publishing articles`, error.stack);
      throw new InternalServerErrorException('Failed to publish articles');
    }
  }

  @Post('articles/:id/publish')
  async publishArticle(@Param('id') id: string) {
    try {
      const result = await this.newsArticleService.publishToWordPress(id);
      return {
        message: 'Article published to WordPress successfully',
        data: result,
      };
    } catch (error: any) {
      this.logger.error(`Error publishing article ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to publish article');
    }
  }
}
