import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FirecrawlService } from './firecrawl.service';
import { AIFilterService } from './ai-filter.service';
import { NewsArticleService } from './news-article.service';

@Injectable()
export class CronjobService {
  private readonly logger = new Logger(CronjobService.name);
  private isActive = false;
  private frequency = '0 8 * * *';
  private readonly JOB_NAME = 'daily_news_crawler';

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private firecrawlService: FirecrawlService,
    private aiFilterService: AIFilterService,
    private newsArticleService: NewsArticleService,
  ) {}

  getConfig() {
    return {
      isActive: this.isActive,
      frequency: this.frequency,
    };
  }

  updateConfig(isActive: boolean, frequency: string) {
    this.isActive = isActive;
    if (frequency) {
      this.frequency = frequency;
    }

    // Try to delete existing job if any
    try {
      this.schedulerRegistry.deleteCronJob(this.JOB_NAME);
    } catch {
      // Job might not exist, ignore
    }

    if (this.isActive) {
      const job = new CronJob(this.frequency, async () => {
        this.logger.log(
          `Executing scheduled job at ${new Date().toISOString()}`,
        );
        await this.executeCrawlFlow();
      });

      this.schedulerRegistry.addCronJob(this.JOB_NAME, job);
      job.start();
      this.logger.log(
        `Cronjob configured and started with frequency: ${this.frequency}`,
      );
    } else {
      this.logger.log('Cronjob is disabled.');
    }

    return this.getConfig();
  }

  private async executeCrawlFlow() {
    let filePath: string | null = null;
    try {
      filePath = await this.firecrawlService.crawlData();
      const top5Articles = await this.aiFilterService.filterAndRank(filePath);

      if (top5Articles && top5Articles.length > 0) {
        // Automatically save it
        await this.newsArticleService.saveArticles(top5Articles);
        this.logger.log(
          `Successfully crawled and saved ${top5Articles.length} articles via cron.`,
        );
      }
    } catch (error: any) {
      this.logger.error('Error executing cron flow', error.stack);
    } finally {
      if (filePath) {
        import('fs').then((fs) => {
          fs.promises
            .unlink(filePath!)
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
}
