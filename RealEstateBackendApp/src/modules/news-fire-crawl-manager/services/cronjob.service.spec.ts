jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(function (this: any, frequency: string, callback: () => Promise<void>) {
    this.frequency = frequency;
    this.callback = callback;
    this.start = jest.fn();
    return this;
  }),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';
import { CronjobService } from './cronjob.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('CronjobService', () => {
  let service: CronjobService;
  let schedulerRegistry: { deleteCronJob: jest.Mock; addCronJob: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    schedulerRegistry = {
      deleteCronJob: jest.fn(),
      addCronJob: jest.fn(),
    };
    configService = { get: jest.fn() };

    // Default env fallback
    configService.get.mockImplementation((key: string) => {
      if (key === 'DAILY_CRAWLER_ACTIVE') return undefined;
      if (key === 'DAILY_CRAWLER_FREQUENCY') return undefined;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronjobService,
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(CronjobService);
  });

  describe('onApplicationBootstrap', () => {
    it('uses default values when .env is empty', () => {
      service.onApplicationBootstrap();
      expect(service.getConfig()).toEqual({ isActive: false, frequency: '0 8 * * *' });
      expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
    });

    it('loads isActive=true and frequency from .env and starts cron', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'DAILY_CRAWLER_ACTIVE') return 'true';
        if (key === 'DAILY_CRAWLER_FREQUENCY') return '0 12 * * *';
        return undefined;
      });

      service.onApplicationBootstrap();
      
      expect(service.getConfig()).toEqual({ isActive: true, frequency: '0 12 * * *' });
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('daily_news_crawler', expect.anything());
    });
  });

  describe('updateConfig', () => {
    it('registers, starts Daily News Crawler, and saves to .env when enabled', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const config = service.updateConfig(true, '0 6 * * *');

      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('daily_news_crawler');
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('daily_news_crawler', expect.anything());
      expect(CronJob).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));
      expect(config).toEqual({ isActive: true, frequency: '0 6 * * *' });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(process.cwd(), '.env'),
        'DAILY_CRAWLER_ACTIVE=true\nDAILY_CRAWLER_FREQUENCY=0 6 * * *\n',
        'utf8'
      );
    });

    it('replaces existing values in .env when updating', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('SOME_VAR=1\nDAILY_CRAWLER_ACTIVE=false\nDAILY_CRAWLER_FREQUENCY=0 8 * * *\nOTHER=2');

      service.updateConfig(true, '0 10 * * *');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(process.cwd(), '.env'),
        'SOME_VAR=1\nDAILY_CRAWLER_ACTIVE=true\nDAILY_CRAWLER_FREQUENCY=0 10 * * *\nOTHER=2\n',
        'utf8'
      );
    });

    it('disables the job without registering a new cron task', () => {
      const config = service.updateConfig(false, '');

      expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
      expect(config).toEqual({ isActive: false, frequency: '0 8 * * *' });
    });
  });

  describe('workflow execution', () => {
    it('invokes the registered market-analysis workflow when cron fires', async () => {
      const trigger = jest.fn().mockResolvedValue({ jobId: 'workflow-job-1' });
      service.setMarketAnalysisWorkflowTrigger(trigger);
      service.updateConfig(true, '0 6 * * *');
      const callback = (CronJob as unknown as jest.Mock).mock.calls.at(-1)[1] as () => Promise<void>;

      await callback();

      expect(trigger).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the workflow trigger has not been registered', async () => {
      service.updateConfig(true, '0 6 * * *');
      const callback = (CronJob as unknown as jest.Mock).mock.calls.at(-1)[1] as () => Promise<void>;

      await expect(callback()).resolves.toBeUndefined();
    });
  });
});
