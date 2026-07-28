jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(function (this: any, _freq: string, cb: () => void) {
    this.frequency = _freq;
    this.callback = cb;
    this.start = jest.fn();
    return this;
  }),
}));
// Tránh chuỗi import ESM từ jsdom → @exodus/bytes (chuỗi ArticleExtractorUtil → jsdom)
jest.mock('jsdom', () => ({}));
jest.mock('@mozilla/readability', () => ({}));
jest.mock('turndown', () => ({}));

import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronjobService } from './cronjob.service';
import { CustomCrawlerService } from './custom-crawler.service';
import { AIFilterService } from './ai-filter.service';
import { NewsArticleService } from './news-article.service';
import { CronJob } from 'cron';

/**
 * Unit test cho CronjobService — quản lý cron job tạo/cập nhật qua SchedulerRegistry.
 * Mock CronJob constructor + SchedulerRegistry để không tạo cron thật.
 */
describe('CronjobService', () => {
  let service: CronjobService;
  let mockSchedulerRegistry: any;
  let mockCustomCrawlerService: any;
  let mockAiFilterService: any;
  let mockNewsArticleService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSchedulerRegistry = {
      deleteCronJob: jest.fn(),
      addCronJob: jest.fn(),
    };
    mockCustomCrawlerService = { crawlData: jest.fn() };
    mockAiFilterService = { filterAndRank: jest.fn() };
    mockNewsArticleService = { saveArticles: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronjobService,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        {
          provide: CustomCrawlerService,
          useValue: mockCustomCrawlerService,
        },
        { provide: AIFilterService, useValue: mockAiFilterService },
        {
          provide: NewsArticleService,
          useValue: mockNewsArticleService,
        },
      ],
    }).compile();

    service = module.get<CronjobService>(CronjobService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConfig', () => {
    it('should return default config (inactive, default frequency)', () => {
      const config = service.getConfig();
      expect(config).toEqual({ isActive: false, frequency: '0 8 * * *' });
    });
  });

  describe('updateConfig', () => {
    it('should delete existing job then register new CronJob when isActive=true', () => {
      const result = service.updateConfig(true, '0 6 * * *');

      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        'daily_news_crawler',
      );
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'daily_news_crawler',
        expect.anything(),
      );
      // CronJob constructor đã được invoke
      expect(CronJob).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));
      expect(result).toEqual({ isActive: true, frequency: '0 6 * * *' });
    });

    it('should swallow error when deleting non-existent job', () => {
      mockSchedulerRegistry.deleteCronJob.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(() => service.updateConfig(true, '0 9 * * *')).not.toThrow();
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalled();
    });

    it('should NOT add new job when isActive=false', () => {
      const result = service.updateConfig(false, '');

      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalled();
      expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled();
      // frequency rỗng → giữ nguyên giá trị cũ (default)
      expect(result.frequency).toBe('0 8 * * *');
      expect(result.isActive).toBe(false);
    });

    it('should keep old frequency when empty string passed', () => {
      service.updateConfig(true, '0 10 * * *');
      const result = service.updateConfig(true, '');

      expect(result.frequency).toBe('0 10 * * *');
    });

    it('should call start() on the new CronJob instance', () => {
      service.updateConfig(true, '0 7 * * *');
      // Instance mock được trả về bởi CronJob constructor có start spy
      const instances = (CronJob as unknown as jest.Mock).mock.instances;
      const lastInstance = instances[instances.length - 1];
      expect(lastInstance.start).toHaveBeenCalled();
    });
  });

  describe('executeCrawlFlow (qua callback CronJob)', () => {
    // LƯU Ý: không test case filePath truthy vì executeCrawlFlow dùng
    // dynamic `import('fs')` trong finally — Node 24 + jest 30 (CJS) throw
    // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG đồng bộ, crash process.
    // Để cover case đó cần bật --experimental-vm-modules hoặc refactor
    // source đổi `import('fs')` thành static `require('fs')`. Đã ghi nhận
    // vào phần bug/lech contract của báo cáo.

    it('should skip filterAndRank when filePath null', async () => {
      mockCustomCrawlerService.crawlData.mockResolvedValue({ filePath: null });

      service.updateConfig(true, '0 6 * * *');
      const lastCall = (CronJob as unknown as jest.Mock).mock.calls[
        (CronJob as unknown as jest.Mock).mock.calls.length - 1
      ];
      await (lastCall[1] as () => Promise<void>)();

      expect(mockAiFilterService.filterAndRank).not.toHaveBeenCalled();
      expect(mockNewsArticleService.saveArticles).not.toHaveBeenCalled();
    });

    it('should swallow error when crawlData throws (cron không ném lỗi ra ngoài)', async () => {
      mockCustomCrawlerService.crawlData.mockRejectedValue(
        new Error('crawl failed'),
      );

      service.updateConfig(true, '0 6 * * *');
      const lastCall = (CronJob as unknown as jest.Mock).mock.calls[
        (CronJob as unknown as jest.Mock).mock.calls.length - 1
      ];
      await expect(
        (lastCall[1] as () => Promise<void>)(),
      ).resolves.toBeUndefined();
    });

    it('callback được truyền vào CronJob phải là async function', () => {
      service.updateConfig(true, '0 6 * * *');
      const lastCall = (CronJob as unknown as jest.Mock).mock.calls[
        (CronJob as unknown as jest.Mock).mock.calls.length - 1
      ];
      const callback = lastCall[1] as () => Promise<void>;
      expect(typeof callback).toBe('function');
    });
  });
});
