import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';

/** Callback được controller đăng ký để CronjobService không phụ thuộc vòng vào controller. */
type MarketAnalysisWorkflowTrigger = () => Promise<{ jobId: string }> | { jobId: string };

@Injectable()
export class CronjobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronjobService.name);
  private isActive = false;
  private frequency = '0 8 * * *';
  private readonly JOB_NAME = 'daily_news_crawler';
  private marketAnalysisWorkflowTrigger?: MarketAnalysisWorkflowTrigger;

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private configService: ConfigService,
  ) {}

  /**
   * Khởi tạo cấu hình từ .env hoặc fallback giá trị mặc định khi start app.
   */
  onApplicationBootstrap() {
    const envFileConfig = this.loadConfigFromEnvFile();
    const envActive = envFileConfig.isActive ?? this.configService.get<string>('DAILY_CRAWLER_ACTIVE');
    const envFreq = envFileConfig.frequency ?? this.configService.get<string>('DAILY_CRAWLER_FREQUENCY');

    this.isActive = envActive === 'true';
    if (envFreq && envFreq.trim() !== '') {
      this.frequency = envFreq;
    }

    if (this.isActive) {
      this.startCron();
    } else {
      this.logger.log('Cronjob is currently disabled from persistent env configuration.');
    }
  }

  private getCronConfigFilePath(): string {
    return this.configService.get<string>('CRON_CONFIG_FILE') || path.resolve(process.cwd(), '.env');
  }

  /** Đọc trực tiếp file bind-mount vì process.env không đổi sau khi runtime sửa .env. */
  private loadConfigFromEnvFile(): { isActive?: string; frequency?: string } {
    try {
      const envPath = this.getCronConfigFilePath();
      if (!fs.existsSync(envPath)) return {};
      const content = fs.readFileSync(envPath, 'utf8');
      return {
        isActive: content.match(/^DAILY_CRAWLER_ACTIVE=(.*)$/m)?.[1]?.trim(),
        frequency: content.match(/^DAILY_CRAWLER_FREQUENCY=(.*)$/m)?.[1]?.trim(),
      };
    } catch (error: any) {
      this.logger.error('Failed to load persistent cron configuration', error?.stack);
      return {};
    }
  }

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

    this.saveConfigToEnv(this.isActive, this.frequency);

    try {
      this.schedulerRegistry.deleteCronJob(this.JOB_NAME);
    } catch {
      // Job might not exist, ignore.
    }

    if (this.isActive) {
      this.startCron();
    } else {
      this.logger.log('Cronjob is disabled.');
    }

    return this.getConfig();
  }

  private startCron() {
    try {
      const job = new CronJob(this.frequency, async () => {
        this.logger.log(`Executing Daily News Crawler at ${new Date().toISOString()}`);
        await this.executeWorkflow();
      });

      this.schedulerRegistry.addCronJob(this.JOB_NAME, job);
      job.start();
      this.logger.log(`Cronjob configured and started with frequency: ${this.frequency}`);
    } catch (error: any) {
      this.logger.error(`Failed to start cron with frequency: ${this.frequency}`, error?.stack);
    }
  }

  /**
   * Lưu cấu hình ra file .env ở thư mục gốc của project (nơi được Docker mount).
   * Dùng regex để replace (nếu có) hoặc append (nếu chưa có).
   */
  private saveConfigToEnv(isActive: boolean, frequency: string) {
    try {
      const envPath = this.getCronConfigFilePath();
      let envContent = '';

      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      // Regex replace values
      const activeRegex = /^DAILY_CRAWLER_ACTIVE=.*$/m;
      const freqRegex = /^DAILY_CRAWLER_FREQUENCY=.*$/m;

      if (activeRegex.test(envContent)) {
        envContent = envContent.replace(activeRegex, `DAILY_CRAWLER_ACTIVE=${isActive}`);
      } else {
        envContent += `\nDAILY_CRAWLER_ACTIVE=${isActive}`;
      }

      if (freqRegex.test(envContent)) {
        envContent = envContent.replace(freqRegex, `DAILY_CRAWLER_FREQUENCY=${frequency}`);
      } else {
        envContent += `\nDAILY_CRAWLER_FREQUENCY=${frequency}`;
      }

      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
      this.logger.log(`Saved cron configuration to .env`);
    } catch (error: any) {
      this.logger.error('Failed to save cron configuration to .env', error?.stack);
    }
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
