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
import { CronJob } from 'cron';
import { CronjobService } from './cronjob.service';

describe('CronjobService', () => {
  let service: CronjobService;
  let schedulerRegistry: { deleteCronJob: jest.Mock; addCronJob: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    schedulerRegistry = {
      deleteCronJob: jest.fn(),
      addCronJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronjobService,
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get(CronjobService);
  });

  it('returns the inactive default configuration', () => {
    expect(service.getConfig()).toEqual({ isActive: false, frequency: '0 8 * * *' });
  });

  it('registers and starts Daily News Crawler when enabled', () => {
    const config = service.updateConfig(true, '0 6 * * *');

    expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('daily_news_crawler');
    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('daily_news_crawler', expect.anything());
    expect(CronJob).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));
    expect(config).toEqual({ isActive: true, frequency: '0 6 * * *' });
  });

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

  it('disables the job without registering a new cron task', () => {
    const config = service.updateConfig(false, '');

    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
    expect(config).toEqual({ isActive: false, frequency: '0 8 * * *' });
  });
});
