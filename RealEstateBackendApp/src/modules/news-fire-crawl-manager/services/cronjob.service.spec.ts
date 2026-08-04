jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation(function (this: any, _freq: string, cb: () => void) {
    this.frequency = _freq;
    this.callback = cb;
    this.start = jest.fn();
    return this;
  }),
}));
// Mock fs để verify unlink temp file trong finally (sau khi đổi sang static import).
jest.mock('fs', () => ({
  __esModule: true,
  default: {
    promises: { unlink: jest.fn().mockResolvedValue(undefined) },
  },
  promises: { unlink: jest.fn().mockResolvedValue(undefined) },
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
import * as fs from 'fs';

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

  describe('executeCrawlFlow (qa callback CronJob)', () => {
    // Sau fix dynamic import('fs') → static import, có thể test happy-path
    // filePath truthy: gọi filterAndRank + saveArticles + xoá temp file.

    const runLastCallback = async () => {
      service.updateConfig(true, '0 6 * * *');
      const lastCall = (CronJob as unknown as jest.Mock).mock.calls[
        (CronJob as unknown as jest.Mock).mock.calls.length - 1
      ];
      return (lastCall[1] as () => Promise<void>)();
    };

    it('should skip filterAndRank when filePath null', async () => {
      mockCustomCrawlerService.crawlData.mockResolvedValue({ filePath: null });

      await runLastCallback();

      expect(mockAiFilterService.filterAndRank).not.toHaveBeenCalled();
      expect(mockNewsArticleService.saveArticles).not.toHaveBeenCalled();
    });

    it('filePath present → gọi filterAndRank + saveArticles + xoá temp file', async () => {
      mockCustomCrawlerService.crawlData.mockResolvedValue({
        filePath: '/tmp/crawl.json',
      });
      mockAiFilterService.filterAndRank.mockResolvedValue([
        { url: 'https://x', title: 'T1' },
      ]);
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink');

      await runLastCallback();

      expect(mockAiFilterService.filterAndRank).toHaveBeenCalledWith(
        '/tmp/crawl.json',
      );
      expect(mockNewsArticleService.saveArticles).toHaveBeenCalledWith([
        { url: 'https://x', title: 'T1' },
      ]);
      // finally xoá temp file qua static fs.promises.unlink.
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/crawl.json');
    });

    it('filePath present nhưng saveArticles không chạy khi top5 rỗng', async () => {
      mockCustomCrawlerService.crawlData.mockResolvedValue({
        filePath: '/tmp/empty.json',
      });
      mockAiFilterService.filterAndRank.mockResolvedValue([]);
      const unlinkSpy = jest.spyOn(fs.promises, 'unlink');

      await runLastCallback();

      expect(mockAiFilterService.filterAndRank).toHaveBeenCalled();
      expect(mockNewsArticleService.saveArticles).not.toHaveBeenCalled();
      // Vẫn xoá temp file trong finally.
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/empty.json');
    });

    it('should swallow error when crawlData throws (cron không ném lỗi ra ngoài)', async () => {
      mockCustomCrawlerService.crawlData.mockRejectedValue(
        new Error('crawl failed'),
      );

      await expect(runLastCallback()).resolves.toBeUndefined();
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
