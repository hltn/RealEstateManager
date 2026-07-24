import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Delete,
  Logger,
  InternalServerErrorException,
  HttpException,
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

  @Get('raw-articles')
  async getRawArticles(@Query('search') search?: string, @Query('sort') sort?: 'newest' | 'oldest') {
    try {
      const articles = await this.firecrawlService.getRawArticles(search, sort);
      return {
        message: 'Raw articles fetched successfully',
        data: articles,
      };
    } catch (error: any) {
      this.logger.error('Error fetching raw articles', error.stack);
      throw new InternalServerErrorException('Failed to fetch raw articles');
    }
  }

  @Delete('raw-articles/:id')
  async deleteRawArticle(@Param('id') id: string) {
    try {
      await this.firecrawlService.deleteRawArticle(id);
      return { message: 'Raw article deleted successfully' };
    } catch (error: any) {
      this.logger.error(`Error deleting raw article ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to delete raw article');
    }
  }

  @Post('raw-articles/delete-bulk')
  async deleteRawArticlesBulk(@Body('ids') ids: string[]) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { message: 'No articles to delete' };
      }
      await this.firecrawlService.deleteRawArticlesBulk(ids);
      return { message: 'Raw articles deleted successfully' };
    } catch (error: any) {
      this.logger.error('Error bulk deleting raw articles', error.stack);
      throw new InternalServerErrorException('Failed to bulk delete raw articles');
    }
  }

  @Post('raw-articles/move-bulk')
  async moveRawArticlesBulk(@Body('ids') ids: string[]) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { message: 'No articles to move' };
      }
      const rawArticles = await this.firecrawlService.getRawArticlesByIds(ids);
      if (rawArticles.length > 0) {
        const { processedUrlHashes } = await this.newsArticleService.saveArticles(rawArticles);
        
        const successfulIds = rawArticles
          .filter(raw => raw.urlHash && processedUrlHashes.includes(raw.urlHash))
          .map(raw => raw._id.toString());
          
        if (successfulIds.length > 0) {
          await this.firecrawlService.deleteRawArticlesBulk(successfulIds);
        }
      }
      return { message: 'Raw articles moved successfully' };
    } catch (error: any) {
      this.logger.error('Error bulk moving raw articles', error.stack);
      throw new InternalServerErrorException('Failed to bulk move raw articles');
    }
  }

  @Post('crawl')
  async triggerManualCrawl() {
    try {
      this.logger.log('Manual crawl called');
      const filePath = await this.firecrawlService.crawlData();
      
      const fs = require('fs');
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      return {
        message: 'Crawl completed successfully',
        filePath,
        data: rawData,
      };
    } catch (error: any) {
      this.logger.error('Error in manual crawl', error.stack);
      throw new InternalServerErrorException(
        'Failed to process crawl',
      );
    }
  }

  @Post('analyze')
  async triggerManualAnalyze(@Body('filePath') filePath: string) {
    if (!filePath) {
      return { message: 'filePath is required', data: [] };
    }
    try {
      this.logger.log('Manual analyze called');
      const top5Articles = await this.aiFilterService.filterAndRank(filePath);

      return {
        message: 'AI filtering completed successfully',
        data: top5Articles,
      };
    } catch (error: any) {
      this.logger.error('Error in manual analyze', error.stack);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to process filter',
      );
    } finally {
      if (filePath) {
        import('fs').then((fs) => {
          fs.promises
            .unlink(filePath)
            .catch((err) =>
              this.logger.error(
                `Failed to delete temp file ${filePath}`,
                err.stack,
              ),
            );
        });
      }
    }
  }

  @Post('analyze-raw')
  async analyzeRawArticles(@Body('articles') articles: any[]) {
    try {
      this.logger.log('Analyze Raw Articles called');
      if (!articles || articles.length === 0) {
        return { message: 'No articles to analyze', data: [] };
      }
      const filteredArticles = await this.aiFilterService.filterRawArticles(articles);
      
      if (filteredArticles && filteredArticles.length > 0) {
        const keepUrls = filteredArticles.map((a: any) => a.urlHash);
        await this.firecrawlService.deleteRawArticlesNotIn(keepUrls);
      } else {
        // If AI returned empty, maybe we should delete all or keep all?
        // Prompt says "delete all records... that are NOT present in the AI's returned list".
        // If empty list returned, it deletes everything. This is correct as per instructions.
        await this.firecrawlService.deleteRawArticlesNotIn([]);
      }
      
      return {
        message: 'Raw articles filtered successfully',
        data: filteredArticles,
      };
    } catch (error: any) {
      this.logger.error('Error in analyze raw articles', error.stack);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to analyze raw articles',
      );
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


  @Post('articles/delete-bulk')
  async deleteBulkArticles(@Body('ids') ids: string[]) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { message: 'No articles to delete' };
      }
      const result = await this.newsArticleService.deleteBulkArticles(ids);
      return {
        message: 'Articles deleted successfully',
        data: result,
      };
    } catch (error: any) {
      this.logger.error('Error bulk deleting articles', error.stack);
      throw new InternalServerErrorException('Failed to bulk delete articles');
    }
  }

  @Post('articles/publish-bulk')
  async publishBulkArticles(@Body('ids') ids: string[]) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { message: 'No articles to publish' };
      }

      const results = await Promise.all(
        ids.map((id) => this.newsArticleService.publishToWordPress(id)),
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
