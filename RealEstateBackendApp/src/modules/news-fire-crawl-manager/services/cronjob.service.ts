import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

/** Callback được controller đăng ký để CronjobService không phụ thuộc vòng vào controller. */
type MarketAnalysisWorkflowTrigger = () => Promise<{ jobId: string }> | { jobId: string };

@Injectable()
export class CronjobService {
  private readonly logger = new Logger(CronjobService.name);
  private isActive = false;
  private frequency = '0 8 * * *';
  private readonly JOB_NAME = 'daily_news_crawler';
  private marketAnalysisWorkflowTrigger?: MarketAnalysisWorkflowTrigger;

  constructor(private schedulerRegistry: SchedulerRegistry) {}

  /**
   * Đăng ký workflow đầy đủ cho Daily News Crawler. Callback được cung cấp bởi
   * controller sau khi module khởi tạo để tránh circular dependency.
   */
  setMarketAnalysisWorkflowTrigger(trigger: MarketAnalysisWorkflowTrigger): void {
    this.marketAnalysisWorkflowTrigger = trigger;
  }

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

    try {
      this.schedulerRegistry.deleteCronJob(this.JOB_NAME);
    } catch {
      // Job might not exist, ignore.
    }

    if (this.isActive) {
      const job = new CronJob(this.frequency, async () => {
        this.logger.log(`Executing Daily News Crawler at ${new Date().toISOString()}`);
        await this.executeWorkflow();
      });

      this.schedulerRegistry.addCronJob(this.JOB_NAME, job);
      job.start();
      this.logger.log(`Cronjob configured and started with frequency: ${this.frequency}`);
    } else {
      this.logger.log('Cronjob is disabled.');
    }

    return this.getConfig();
  }

  /**
   * Daily News Crawler luôn kích hoạt toàn bộ workflow phân tích thị trường.
   * Ngày đầu vào do callback tự xác định theo ngày hiện tại UTC+7, không nhận
   * giá trị ngày từ cron để tránh chạy nhầm ngày.
   */
  private async executeWorkflow(): Promise<void> {
    if (!this.marketAnalysisWorkflowTrigger) {
      this.logger.error('Daily News Crawler skipped: market analysis workflow trigger is not registered.');
      return;
    }

    try {
      const { jobId } = await this.marketAnalysisWorkflowTrigger();
      this.logger.log(`Daily News Crawler started market analysis workflow job ${jobId}.`);
    } catch (error: any) {
      this.logger.error('Error triggering market analysis workflow from cron', error?.stack);
    }
  }
}
