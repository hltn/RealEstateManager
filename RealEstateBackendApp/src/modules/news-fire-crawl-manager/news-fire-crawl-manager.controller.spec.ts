/**
 * NewsFireCrawlManagerController unit spec — contract mục 2 (Response Format phân trang,
 * Idempotency), mục 4 (Compensating Transaction, Audit Trail fire-and-forget).
 *
 * Bao phủ:
 * - getRawArticles / getArticles → trả { data, meta: { total, page, limit, totalPages } }.
 * - publishArticle / publishBulkArticles → Idempotency-Key: cache hit, in-flight Conflict,
 *   set cache sau khi xong, clearInFlight trong finally.
 * - moveRawArticlesBulk → compensating transaction khi deleteRawArticlesBulk fail sau save.
 * - deleteRawArticlesBulk / deleteBulkArticles → guard mảng rỗng + audit log fire-and-forget.
 * - analyzeRawArticles → trả jobId ngay, job chạy nền.
 * - getAnalyzeRawJob → not_found khi jobId chưa có.
 * - triggerManualCrawl (async) → trả { message, jobId } ngay, crawlData chạy nền + markDone; ConflictException khi lock in-flight.
 * - triggerManualAnalyze → filePath rỗng trả message + data rỗng; cleanup file trong finally.
 * - getManualCrawlJob → poll trạng thái job crawl, not_found khi hết TTL.
 *
 * Gọi method trực tiếp (param decorator @Query/@Body/@Headers/@Param chỉ active qua runtime).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';

// Controller import NewsArticleService → ArticleExtractorUtil → jsdom →
// @exodus/bytes (ESM) làm Jest parse fail. Mock jsdom rỗng để break chain,
// giống convention news-article.service.spec.ts.
jest.mock('jsdom', () => ({}));
// Mock fs để triggerManualCrawl không đọc đĩa thật; readFileSync là
// non-configurable trên builtin nên phải dùng factory mock (không spyOn được).
// Bao gồm promises.unlink cho triggerManualAnalyze cleanup temp file.
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  promises: { unlink: jest.fn().mockResolvedValue(undefined) },
}));
import { NewsFireCrawlManagerController } from './news-fire-crawl-manager.controller';
import { CustomCrawlerService } from './services/custom-crawler.service';
import { AIFilterService } from './services/ai-filter.service';
import { NewsArticleService } from './services/news-article.service';
import { CronjobService } from './services/cronjob.service';
import { AiPromptConfigService } from './services/ai-prompt-config.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { AuditLogService } from './services/audit-log.service';
import { AnalyzeJobService } from './services/analyze-job.service';
import { AuditAction } from './schemas/audit-log.schema';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

describe('NewsFireCrawlManagerController', () => {
  let controller: NewsFireCrawlManagerController;
  let customCrawlerService: jest.Mocked<CustomCrawlerService>;
  let aiFilterService: jest.Mocked<AIFilterService>;
  let newsArticleService: jest.Mocked<NewsArticleService>;
  let cronjobService: jest.Mocked<CronjobService>;
  let aiPromptConfigService: jest.Mocked<AiPromptConfigService>;
  let idempotencyService: jest.Mocked<IdempotencyService>;
  let auditLogService: jest.Mocked<AuditLogService>;
  let analyzeJobService: jest.Mocked<AnalyzeJobService>;

  beforeEach(async () => {
    customCrawlerService = {
      getRawArticles: jest.fn(),
      deleteRawArticle: jest.fn(),
      deleteRawArticlesBulk: jest.fn(),
      getRawArticlesByIds: jest.fn(),
      crawlData: jest.fn(),
      deleteRawArticlesInSetNotIn: jest.fn(),
      getRawArticlesByDate: jest.fn(),
    } as unknown as jest.Mocked<CustomCrawlerService>;

    aiFilterService = {
      filterAndRank: jest.fn(),
      filterRawArticles: jest.fn(),
    } as unknown as jest.Mocked<AIFilterService>;

    newsArticleService = {
      saveArticles: jest.fn(),
      deleteArticlesByUrlHashes: jest.fn(),
      getSavedArticles: jest.fn(),
      getArticleById: jest.fn(),
      getMarketAnalysisHistory: jest.fn(),
      getMarketAnalysisHistoryById: jest.fn(),
      analyzeMarketTrendsByAI: jest.fn(),
      analyzeMarketBulk: jest.fn(),
      deleteBulkArticles: jest.fn(),
      publishToWordPress: jest.fn(),
      cleanArticle: jest.fn(),
      getArticleIdsByUrlHashes: jest.fn(),
    } as unknown as jest.Mocked<NewsArticleService>;

    cronjobService = {
      getConfig: jest.fn(),
      updateConfig: jest.fn(),
    } as unknown as jest.Mocked<CronjobService>;

    aiPromptConfigService = {
      getPrompts: jest.fn(),
      getPromptByName: jest.fn(),
      updatePrompts: jest.fn(),
    } as unknown as jest.Mocked<AiPromptConfigService>;

    idempotencyService = {
      get: jest.fn(),
      set: jest.fn(),
      isInFlight: jest.fn(),
      markInFlight: jest.fn(),
      clearInFlight: jest.fn(),
    } as unknown as jest.Mocked<IdempotencyService>;

    auditLogService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogService>;

    analyzeJobService = {
      createJob: jest.fn(),
      getJob: jest.fn(),
      markDone: jest.fn(),
      markError: jest.fn(),
      updateJob: jest.fn(),
    } as unknown as jest.Mocked<AnalyzeJobService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NewsFireCrawlManagerController],
      providers: [
        { provide: CustomCrawlerService, useValue: customCrawlerService },
        { provide: AIFilterService, useValue: aiFilterService },
        { provide: NewsArticleService, useValue: newsArticleService },
        { provide: CronjobService, useValue: cronjobService },
        { provide: AiPromptConfigService, useValue: aiPromptConfigService },
        { provide: IdempotencyService, useValue: idempotencyService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: AnalyzeJobService, useValue: analyzeJobService },
      ],
    }).compile();

    controller = module.get<NewsFireCrawlManagerController>(NewsFireCrawlManagerController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getPrompts / updatePrompts', () => {
    it('getPrompts → trả { success: true, data } từ service.getPrompts()', () => {
      aiPromptConfigService.getPrompts.mockReturnValue([{ api_ai_name: 'X', api_ai_path: '/x', prompt: 'p' }]);
      const result = controller.getPrompts();
      expect(result).toEqual({ success: true, data: expect.any(Array) });
    });

    it('updatePrompts → gọi service.updatePrompts + trả message', async () => {
      const prompts = [{ api_ai_name: 'X', api_ai_path: '/x', prompt: 'p' }];
      await controller.updatePrompts(prompts as any);
      expect(aiPromptConfigService.updatePrompts).toHaveBeenCalledWith(prompts);
    });
  });

  describe('cron config', () => {
    it('getCronConfig → delegate service.getConfig()', () => {
      cronjobService.getConfig.mockReturnValue({ isActive: true, frequency: '0 8 * * *' });
      expect(controller.getCronConfig()).toEqual({ isActive: true, frequency: '0 8 * * *' });
    });

    it('updateCronConfig → gọi updateConfig(isActive, frequency)', () => {
      cronjobService.updateConfig.mockReturnValue({ isActive: false, frequency: '0 8 * * *' });
      controller.updateCronConfig({ isActive: false, frequency: '0 0 * * *' } as any);
      expect(cronjobService.updateConfig).toHaveBeenCalledWith(false, '0 0 * * *');
    });
  });

  describe('getRawArticles — Response Format phân trang chuẩn', () => {
    it('trả { data, meta: { total, page, limit, totalPages } } đúng shape', async () => {
      customCrawlerService.getRawArticles.mockResolvedValue({ data: [{ _id: 'a' }], total: 25 });

      const result = await controller.getRawArticles({
        page: 2, limit: 10,
      } as any);

      // Service nhận page/limit đã chuẩn hóa (2, 10).
      expect(customCrawlerService.getRawArticles).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, 2, 10);
      expect(result.meta).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
      expect(result.data).toEqual([{ _id: 'a' }]);
    });

    it('total=0 → totalPages=0 (không NaN/Infinity)', async () => {
      customCrawlerService.getRawArticles.mockResolvedValue({ data: [], total: 0 });
      const result = await controller.getRawArticles({ page: 1, limit: 20 } as any);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('deleteRawArticle', () => {
    it('gọi service.deleteRawArticle(id) + audit log DELETE fire-and-forget', async () => {
      await controller.deleteRawArticle('abc');
      expect(customCrawlerService.deleteRawArticle).toHaveBeenCalledWith('abc');
      expect(auditLogService.log).toHaveBeenCalledWith(AuditAction.DELETE, 'raw_articles', ['abc'], 'system');
    });
  });

  describe('deleteRawArticlesBulk', () => {
    it('ids rỗng → trả message, KHÔNG gọi service', async () => {
      const result = await controller.deleteRawArticlesBulk({ ids: [] } as any);
      expect(result).toEqual({ message: 'No articles to delete' });
      expect(customCrawlerService.deleteRawArticlesBulk).not.toHaveBeenCalled();
    });

    it('ids có giá trị → gọi service + audit BULK_DELETE', async () => {
      await controller.deleteRawArticlesBulk({ ids: ['1', '2'] } as any);
      expect(customCrawlerService.deleteRawArticlesBulk).toHaveBeenCalledWith(['1', '2']);
      expect(auditLogService.log).toHaveBeenCalledWith(AuditAction.BULK_DELETE, 'raw_articles', ['1', '2'], 'system', { count: 2 });
    });
  });

  describe('moveRawArticlesBulk — Compensating Transaction', () => {
    it('happy path: save → delete thành công, audit BULK_MOVE', async () => {
      customCrawlerService.getRawArticlesByIds.mockResolvedValue([
        { _id: { toString: () => '1' }, urlHash: 'h1' },
        { _id: { toString: () => '2' }, urlHash: 'h2' },
      ]);
      newsArticleService.saveArticles.mockResolvedValue({
        savedCount: 2, duplicates: 0,
        processedUrlHashes: ['h1', 'h2'], newlySavedUrlHashes: ['h1', 'h2'],
      });

      const result = await controller.moveRawArticlesBulk({ ids: ['1', '2'] } as any);

      expect(newsArticleService.saveArticles).toHaveBeenCalled();
      expect(customCrawlerService.deleteRawArticlesBulk).toHaveBeenCalledWith(['1', '2']);
      expect(auditLogService.log).toHaveBeenCalledWith(AuditAction.BULK_MOVE, 'raw_articles', ['1', '2'], 'system', expect.objectContaining({ count: 2 }));
      expect(result).toEqual({ message: 'Raw articles moved successfully' });
    });

    it('ids rỗng → trả message, không gọi service', async () => {
      const result = await controller.moveRawArticlesBulk({ ids: [] } as any);
      expect(result).toEqual({ message: 'No articles to move' });
      expect(customCrawlerService.getRawArticlesByIds).not.toHaveBeenCalled();
    });

    it('deleteRawArticlesBulk fail sau save → rollback newlySavedUrlHashes + rethrow', async () => {
      customCrawlerService.getRawArticlesByIds.mockResolvedValue([
        { _id: { toString: () => '1' }, urlHash: 'h1' },
      ]);
      newsArticleService.saveArticles.mockResolvedValue({
        savedCount: 1, duplicates: 0,
        processedUrlHashes: ['h1'], newlySavedUrlHashes: ['h1'],
      });
      const delErr = new Error('delete failed');
      customCrawlerService.deleteRawArticlesBulk.mockRejectedValue(delErr);

      await expect(controller.moveRawArticlesBulk({ ids: ['1'] } as any)).rejects.toThrow('delete failed');
      // Rollback: xóa các bài mới save khỏi news_articles.
      expect(newsArticleService.deleteArticlesByUrlHashes).toHaveBeenCalledWith(['h1']);
    });

    it('rollback cũng fail → KHÔNG throw lỗi thứ 2, chỉ log (rethrow lỗi gốc)', async () => {
      customCrawlerService.getRawArticlesByIds.mockResolvedValue([
        { _id: { toString: () => '1' }, urlHash: 'h1' },
      ]);
      newsArticleService.saveArticles.mockResolvedValue({
        savedCount: 1, duplicates: 0,
        processedUrlHashes: ['h1'], newlySavedUrlHashes: ['h1'],
      });
      customCrawlerService.deleteRawArticlesBulk.mockRejectedValue(new Error('delete failed'));
      newsArticleService.deleteArticlesByUrlHashes.mockRejectedValue(new Error('rollback failed'));

      await expect(controller.moveRawArticlesBulk({ ids: ['1'] } as any)).rejects.toThrow('delete failed');
      // Rollback attempt vẫn được gọi.
      expect(newsArticleService.deleteArticlesByUrlHashes).toHaveBeenCalledWith(['h1']);
    });

    it('không có rawArticles → trả message thành công, không save', async () => {
      customCrawlerService.getRawArticlesByIds.mockResolvedValue([]);
      const result = await controller.moveRawArticlesBulk({ ids: ['x'] } as any);
      expect(result).toEqual({ message: 'Raw articles moved successfully' });
      expect(newsArticleService.saveArticles).not.toHaveBeenCalled();
    });
  });

  describe('triggerManualCrawl (async)', () => {
    it('trả { message, jobId } ngay, markInFlight crawl:global + tạo job + audit', async () => {
      analyzeJobService.createJob.mockReturnValue('job-1');
      customCrawlerService.crawlData.mockResolvedValue({
        filePath: '/tmp/x.json',
        stats: { successfulSources: 1, failedSources: 0, totalArticles: 2 },
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([{ a: 1 }, { b: 2 }]));

      const result = await controller.triggerManualCrawl({ days: 3 } as any);

      expect(idempotencyService.markInFlight).toHaveBeenCalledWith('crawl:global');
      expect(analyzeJobService.createJob).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Crawl started', jobId: 'job-1' });
      expect(auditLogService.log).toHaveBeenCalledWith(
        AuditAction.MANUAL_CRAWL,
        'raw_articles',
        [],
        'system',
        expect.objectContaining({ jobId: 'job-1', days: 3 }),
      );
    });

    it('lock in-flight → ConflictException, không tạo job / không audit', () => {
      idempotencyService.isInFlight.mockReturnValue(true);
      expect(() =>
        controller.triggerManualCrawl({ days: 3 } as any),
      ).toThrow(ConflictException);
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      expect(auditLogService.log).not.toHaveBeenCalled();
    });

    it('chạy nền: crawlData(days,...) + markDone count + clearInFlight', async () => {
      analyzeJobService.createJob.mockReturnValue('job-2');
      customCrawlerService.crawlData.mockResolvedValue({
        filePath: '/tmp/y.json',
        stats: { successfulSources: 1, failedSources: 0, totalArticles: 2 },
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([{ a: 1 }, { b: 2 }]));

      await controller.triggerManualCrawl({ days: 3 } as any);
      // Flush fire-and-forget microtasks (crawlData là async, runJob await work()).
      await new Promise(setImmediate);

      expect(customCrawlerService.crawlData).toHaveBeenCalledWith(3, undefined, undefined);
      expect(analyzeJobService.markDone).toHaveBeenCalledWith('job-2', {
        stats: { successfulSources: 1, failedSources: 0, totalArticles: 2 },
        count: 2,
        filePath: '/tmp/y.json',
      });
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('crawl:global');
    });
  });

  describe('getManualCrawlJob', () => {
    it('jobId không có → { status: not_found }', () => {
      analyzeJobService.getJob.mockReturnValue(undefined);
      expect(controller.getManualCrawlJob('missing')).toEqual({ status: 'not_found' });
    });

    it('job có → trả nguyên job object', () => {
      const job = { status: 'done', result: { count: 5 } };
      analyzeJobService.getJob.mockReturnValue(job as any);
      expect(controller.getManualCrawlJob('job-1')).toEqual(job);
    });
  });

  describe('triggerManualAnalyze', () => {
    it('filePath thiếu → trả { message, data: [] } mà không gọi filterAndRank', async () => {
      const result = await controller.triggerManualAnalyze({ filePath: '' } as any);
      expect(result).toEqual({ message: 'filePath is required', data: [] });
      expect(aiFilterService.filterAndRank).not.toHaveBeenCalled();
    });

    it('filePath hợp lệ → gọi filterAndRank, trả data + xoá temp file trong finally', async () => {
      const top5 = [{ url: 'https://x', title: 'T1' }];
      aiFilterService.filterAndRank.mockResolvedValue(top5);
      const unlinkSpy = fs.promises.unlink as unknown as jest.Mock;

      const result = await controller.triggerManualAnalyze({
        filePath: '/tmp/x.json',
      } as any);

      expect(aiFilterService.filterAndRank).toHaveBeenCalledWith('/tmp/x.json');
      expect(result).toEqual({
        message: 'AI filtering completed successfully',
        data: top5,
      });
      // finally xoá temp file qua static fs.promises.unlink.
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/x.json');
    });

    it('filePath hợp lệ nhưng filterAndRank throw → vẫn xoá temp file trong finally', async () => {
      aiFilterService.filterAndRank.mockRejectedValue(new Error('AI down'));
      const unlinkSpy = fs.promises.unlink as unknown as jest.Mock;

      await expect(
        controller.triggerManualAnalyze({ filePath: '/tmp/y.json' } as any),
      ).rejects.toThrow('AI down');
      // finally vẫn chạy dù error → xoá temp file.
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/y.json');
    });
  });

  describe('analyzeRawArticles (async job)', () => {
    it('articles rỗng → trả jobId null + message, không tạo job', () => {
      const result = controller.analyzeRawArticles({ articles: [] } as any);
      expect(result).toEqual({ jobId: null, message: 'No articles to analyze' });
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
    });

    it('articles có giá trị → tạo job, trả jobId ngay lập tức (fire-and-forget)', () => {
      analyzeJobService.createJob.mockReturnValue('job-123');
      const result = controller.analyzeRawArticles({ articles: [{ urlHash: 'h1' }] } as any);
      expect(analyzeJobService.createJob).toHaveBeenCalled();
      expect(result).toEqual({ jobId: 'job-123', message: 'Đã nhận yêu cầu, đang xử lý trong nền' });
    });

    it('job nền: gọi filterRawArticles + deleteRawArticlesInSetNotIn(submittedHashes, keepHashes) + markDone', async () => {
      // Truy xuất private method qua instance để test trực tiếp (tránh race với fire-and-forget).
      aiFilterService.filterRawArticles.mockResolvedValue([{ urlHash: 'h2' }]);
      await (controller as any).runAnalyzeRawArticlesJob('job-1', [
        { urlHash: 'h1' }, { urlHash: 'h2' }, { urlHash: 'h3' },
      ]);
      // submittedHashes = [h1,h2,h3]; keepHashes = [h2] → xóa h1,h3 giữ h2.
      expect(customCrawlerService.deleteRawArticlesInSetNotIn).toHaveBeenCalledWith(['h1', 'h2', 'h3'], ['h2']);
      expect(analyzeJobService.markDone).toHaveBeenCalledWith('job-1', [{ urlHash: 'h2' }]);
    });

    it('job nền lỗi → markError với message', async () => {
      aiFilterService.filterRawArticles.mockRejectedValue(new Error('AI down'));
      await (controller as any).runAnalyzeRawArticlesJob('job-err', [{ urlHash: 'h1' }]);
      expect(analyzeJobService.markError).toHaveBeenCalledWith('job-err', 'AI down');
    });
  });

  describe('getAnalyzeRawJob', () => {
    it('jobId không tồn tại → { status: not_found }', () => {
      analyzeJobService.getJob.mockReturnValue(undefined);
      expect(controller.getAnalyzeRawJob('missing')).toEqual({ status: 'not_found' });
    });

    it('job tồn tại → trả nguyên job object', () => {
      const job = { status: 'done', result: [{ x: 1 }], updatedAt: 123 };
      analyzeJobService.getJob.mockReturnValue(job as any);
      expect(controller.getAnalyzeRawJob('j1')).toEqual(job);
    });
  });

  describe('saveArticles', () => {
    it('articles rỗng → trả message, không gọi service', async () => {
      const result = await controller.saveArticles({ articles: [] } as any);
      expect(result).toEqual({ message: 'No articles to save' });
      expect(newsArticleService.saveArticles).not.toHaveBeenCalled();
    });

    it('articles có giá trị → gọi service.saveArticles + spread result', async () => {
      newsArticleService.saveArticles.mockResolvedValue({ savedCount: 3, duplicates: 1, processedUrlHashes: [], newlySavedUrlHashes: [] });
      const result = await controller.saveArticles({ articles: [{ x: 1 }] } as any);
      expect(newsArticleService.saveArticles).toHaveBeenCalledWith([{ x: 1 }]);
      expect(result).toMatchObject({ message: 'Articles processed', savedCount: 3, duplicates: 1 });
    });
  });

  describe('getArticles — Response Format phân trang', () => {
    it('trả { data, meta } với totalPages đúng', async () => {
      newsArticleService.getSavedArticles.mockResolvedValue({ data: [{ _id: 'a' }], total: 31 });
      const result = await controller.getArticles({ page: 2, limit: 10 } as any);
      expect(newsArticleService.getSavedArticles).toHaveBeenCalledWith(undefined, 2, 10);
      expect(result.meta).toEqual({ total: 31, page: 2, limit: 10, totalPages: 4 });
    });
  });

  describe('getArticleById / getMarketAnalysisHistory(ById)', () => {
    it('getArticleById → trả { message, data }', async () => {
      newsArticleService.getArticleById.mockResolvedValue({ _id: '1' } as any);
      const result = await controller.getArticleById('1');
      expect(result).toEqual({ message: 'Article fetched successfully', data: { _id: '1' } });
    });

    it('getMarketAnalysisHistory → trả { message, data }', async () => {
      newsArticleService.getMarketAnalysisHistory.mockResolvedValue([{ _id: 'h1' }] as any);
      const result = await controller.getMarketAnalysisHistory();
      expect(result).toMatchObject({ message: 'Market analysis history fetched successfully', data: [{ _id: 'h1' }] });
    });

    it('getMarketAnalysisHistoryById → trả { message, data }', async () => {
      newsArticleService.getMarketAnalysisHistoryById.mockResolvedValue({ _id: 'h1' } as any);
      const result = await controller.getMarketAnalysisHistoryById('h1');
      expect(result).toMatchObject({ message: 'Market analysis history record fetched successfully', data: { _id: 'h1' } });
    });
  });

  describe('analyzeMarketTrends (async job) — Idempotency lock chống double-submit', () => {
    const LOCK_KEY = 'analyze-market-trends:global';

    it('ids rỗng → trả message, không tạo job, không check lock', () => {
      const result = controller.analyzeMarketTrends({ ids: [] } as any);
      expect(result).toEqual({ message: 'No articles to analyze' });
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      expect(idempotencyService.isInFlight).not.toHaveBeenCalled();
    });

    it('ids có giá trị, không có job nào đang chạy → markInFlight + tạo job, trả jobId ngay lập tức (fire-and-forget)', () => {
      idempotencyService.isInFlight.mockReturnValue(false);
      analyzeJobService.createJob.mockReturnValue('job-mt-1');
      const result = controller.analyzeMarketTrends({ ids: ['1', '2'] } as any);
      expect(idempotencyService.isInFlight).toHaveBeenCalledWith(LOCK_KEY);
      expect(idempotencyService.markInFlight).toHaveBeenCalledWith(LOCK_KEY);
      expect(analyzeJobService.createJob).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Market trends analysis started', jobId: 'job-mt-1' });
      // Không await job nền trong request handler — service chưa chắc đã được gọi ngay tick này.
    });

    it('đang có job phân tích thị trường khác chạy (double-submit) → ConflictException, KHÔNG tạo job mới', () => {
      idempotencyService.isInFlight.mockReturnValue(true);
      expect(() =>
        controller.analyzeMarketTrends({ ids: ['1', '2'] } as any),
      ).toThrow(ConflictException);
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      expect(idempotencyService.markInFlight).not.toHaveBeenCalled();
    });

    it('job nền: gọi analyzeMarketTrendsByAI(ids) rồi markDone với kết quả markdown + clearInFlight lock', async () => {
      newsArticleService.analyzeMarketTrendsByAI.mockResolvedValue('analysis result' as any);
      await (controller as any).runAnalyzeMarketTrendsJob('job-mt-2', ['1', '2'], LOCK_KEY);
      expect(newsArticleService.analyzeMarketTrendsByAI).toHaveBeenCalledWith(['1', '2']);
      expect(analyzeJobService.markDone).toHaveBeenCalledWith('job-mt-2', 'analysis result');
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith(LOCK_KEY);
    });

    it('job nền lỗi → markError với message, vẫn clearInFlight lock trong finally (không bị stuck lock)', async () => {
      newsArticleService.analyzeMarketTrendsByAI.mockRejectedValue(new Error('AI timeout'));
      await (controller as any).runAnalyzeMarketTrendsJob('job-mt-err', ['1'], LOCK_KEY);
      expect(analyzeJobService.markError).toHaveBeenCalledWith('job-mt-err', 'AI timeout');
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith(LOCK_KEY);
    });
  });

  describe('getAnalyzeMarketTrendsJob', () => {
    it('jobId không tồn tại → { status: not_found }', () => {
      analyzeJobService.getJob.mockReturnValue(undefined);
      expect(controller.getAnalyzeMarketTrendsJob('missing')).toEqual({ status: 'not_found' });
    });

    it('job tồn tại → trả nguyên job object', () => {
      const job = { status: 'done', result: '# Market Analysis', updatedAt: 123 };
      analyzeJobService.getJob.mockReturnValue(job as any);
      expect(controller.getAnalyzeMarketTrendsJob('j1')).toEqual(job);
    });
  });

  describe('analyzeMarketBulk (async job) — Idempotency lock chống double-submit', () => {
    const LOCK_KEY = 'crawl:global';

    it('ids rỗng → trả message, không tạo job, không check lock, không audit', () => {
      const result = controller.analyzeMarketBulk({ ids: [] } as any);
      expect(result).toEqual({ message: 'No articles to analyze' });
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      expect(idempotencyService.isInFlight).not.toHaveBeenCalled();
      expect(auditLogService.log).not.toHaveBeenCalled();
    });

    it('ids có giá trị, không có job nào đang chạy → markInFlight + tạo job, trả jobId ngay lập tức (fire-and-forget) + audit MARKET_ANALYSIS_BULK', () => {
      idempotencyService.isInFlight.mockReturnValue(false);
      analyzeJobService.createJob.mockReturnValue('job-mab-1');
      const result = controller.analyzeMarketBulk({ ids: ['1', '2'] } as any);
      expect(idempotencyService.isInFlight).toHaveBeenCalledWith(LOCK_KEY);
      expect(idempotencyService.markInFlight).toHaveBeenCalledWith(LOCK_KEY);
      expect(analyzeJobService.createJob).toHaveBeenCalled();
      expect(result).toEqual({ jobId: 'job-mab-1', message: 'Bulk market analysis started' });
      // Audit fire-and-forget ngay khi trigger thành công (sau lock, trước job nền).
      expect(auditLogService.log).toHaveBeenCalledWith(
        AuditAction.MARKET_ANALYSIS_BULK,
        'news_articles',
        ['1', '2'],
        'system',
        { jobId: 'job-mab-1', count: 2 },
      );
      // Fire-and-forget: request handler không await job nền — trả ngay jobId.
    });

    it('đang có job bulk khác chạy (double-submit) → ConflictException, KHÔNG tạo job mới, KHÔNG audit', () => {
      idempotencyService.isInFlight.mockReturnValue(true);
      expect(() =>
        controller.analyzeMarketBulk({ ids: ['1', '2'] } as any),
      ).toThrow(ConflictException);
      expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      expect(idempotencyService.markInFlight).not.toHaveBeenCalled();
      expect(auditLogService.log).not.toHaveBeenCalled();
    });

    it('job nền: gọi analyzeMarketBulk(ids) rồi markDone với kết quả + clearInFlight lock', async () => {
      newsArticleService.analyzeMarketBulk.mockResolvedValue({ processed: 2 } as any);
      await (controller as any).runAnalyzeMarketBulkJob('job-mab-2', ['1', '2'], LOCK_KEY);
      expect(newsArticleService.analyzeMarketBulk).toHaveBeenCalledWith(['1', '2']);
      expect(analyzeJobService.markDone).toHaveBeenCalledWith('job-mab-2', { processed: 2 });
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith(LOCK_KEY);
    });

    it('job nền lỗi → markError với message, vẫn clearInFlight lock trong finally (không bị stuck lock)', async () => {
      newsArticleService.analyzeMarketBulk.mockRejectedValue(new Error('AI timeout'));
      await (controller as any).runAnalyzeMarketBulkJob('job-mab-err', ['1'], LOCK_KEY);
      expect(analyzeJobService.markError).toHaveBeenCalledWith('job-mab-err', 'AI timeout');
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith(LOCK_KEY);
    });

    it('markDone throw → KHÔNG reject promise (robustness: lifecycle throw không sinh unhandled rejection)', async () => {
      newsArticleService.analyzeMarketBulk.mockResolvedValue({ processed: 2 } as any);
      analyzeJobService.markDone.mockImplementation(() => {
        throw new Error('markDone boom');
      });
      // Promise phải resolve (không reject) dù markDone ném lỗi.
      await expect(
        (controller as any).runAnalyzeMarketBulkJob('job-md', ['1'], LOCK_KEY),
      ).resolves.toBeUndefined();
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith(LOCK_KEY);
    });

    it('clearInFlight throw → KHÔNG reject promise (robustness: lifecycle throw không sinh unhandled rejection)', async () => {
      newsArticleService.analyzeMarketBulk.mockResolvedValue({ processed: 2 } as any);
      idempotencyService.clearInFlight.mockImplementation(() => {
        throw new Error('clear boom');
      });
      await expect(
        (controller as any).runAnalyzeMarketBulkJob('job-ci', ['1'], LOCK_KEY),
      ).resolves.toBeUndefined();
      expect(analyzeJobService.markDone).toHaveBeenCalledWith('job-ci', { processed: 2 });
    });
  });

  describe('getAnalyzeMarketBulkJob', () => {
    it('jobId không tồn tại → { status: not_found }', () => {
      analyzeJobService.getJob.mockReturnValue(undefined);
      expect(controller.getAnalyzeMarketBulkJob('missing')).toEqual({ status: 'not_found' });
    });

    it('job tồn tại → trả nguyên job object', () => {
      const job = { status: 'done', result: { processed: 2 }, updatedAt: 123 };
      analyzeJobService.getJob.mockReturnValue(job as any);
      expect(controller.getAnalyzeMarketBulkJob('j1')).toEqual(job);
    });
  });

  describe('deleteBulkArticles', () => {
    it('ids rỗng → message, không gọi service', async () => {
      const result = await controller.deleteBulkArticles({ ids: [] } as any);
      expect(result).toEqual({ message: 'No articles to delete' });
    });

    it('ids có giá trị → gọi service + audit BULK_DELETE', async () => {
      newsArticleService.deleteBulkArticles.mockResolvedValue({ deletedCount: 2 });
      const result = await controller.deleteBulkArticles({ ids: ['1', '2'] } as any);
      expect(newsArticleService.deleteBulkArticles).toHaveBeenCalledWith(['1', '2']);
      expect(auditLogService.log).toHaveBeenCalledWith(AuditAction.BULK_DELETE, 'news_articles', ['1', '2'], 'system', { count: 2 });
      expect(result).toMatchObject({ message: 'Articles deleted successfully', data: { deletedCount: 2 } });
    });
  });

  describe('publishArticle — Idempotency', () => {
    it('KHÔNG có idempotencyKey → gọi service.publishToWordPress + audit PUBLISH + trả response', async () => {
      newsArticleService.publishToWordPress.mockResolvedValue({ _id: '1', wpPostId: 999 } as any);
      const result = await controller.publishArticle('1', undefined);
      expect(newsArticleService.publishToWordPress).toHaveBeenCalledWith('1');
      expect(auditLogService.log).toHaveBeenCalledWith(AuditAction.PUBLISH, 'news_articles', ['1'], 'system', { wpPostId: 999 });
      expect(result).toMatchObject({ message: 'Article published to WordPress successfully', data: { wpPostId: 999 } });
      expect(idempotencyService.markInFlight).not.toHaveBeenCalled();
    });

    it('có key + cache hit → trả cached, KHÔNG gọi service', async () => {
      const cached = { message: 'cached', data: { wpPostId: 1 } };
      idempotencyService.get.mockReturnValue(cached);
      const result = await controller.publishArticle('1', 'key-abc');
      expect(idempotencyService.get).toHaveBeenCalledWith('single:key-abc');
      expect(newsArticleService.publishToWordPress).not.toHaveBeenCalled();
      expect(result).toBe(cached);
    });

    it('có key + in-flight → ConflictException', async () => {
      idempotencyService.get.mockReturnValue(null);
      idempotencyService.isInFlight.mockReturnValue(true);
      await expect(controller.publishArticle('1', 'key-abc')).rejects.toThrow(ConflictException);
      expect(newsArticleService.publishToWordPress).not.toHaveBeenCalled();
    });

    it('có key, mới → markInFlight → publish → set cache → clearInFlight trong finally', async () => {
      idempotencyService.get.mockReturnValue(null);
      idempotencyService.isInFlight.mockReturnValue(false);
      newsArticleService.publishToWordPress.mockResolvedValue({ wpPostId: 5 } as any);
      await controller.publishArticle('1', 'key-abc');
      expect(idempotencyService.markInFlight).toHaveBeenCalledWith('single:key-abc');
      expect(idempotencyService.set).toHaveBeenCalledWith('single:key-abc', expect.objectContaining({ message: 'Article published to WordPress successfully' }));
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('single:key-abc');
    });

    it('publish throw → vẫn clearInFlight trong finally, KHÔNG set cache', async () => {
      idempotencyService.get.mockReturnValue(null);
      idempotencyService.isInFlight.mockReturnValue(false);
      newsArticleService.publishToWordPress.mockRejectedValue(new Error('wp down'));
      await expect(controller.publishArticle('1', 'key-abc')).rejects.toThrow('wp down');
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('single:key-abc');
      expect(idempotencyService.set).not.toHaveBeenCalled();
    });
  });

  describe('publishBulkArticles — Idempotency', () => {
    it('ids rỗng → message, không gọi service', async () => {
      const result = await controller.publishBulkArticles({ ids: [] } as any, undefined);
      expect(result).toEqual({ message: 'No articles to publish' });
    });

    it('KHÔNG key → publish all + audit BULK_PUBLISH', async () => {
      newsArticleService.publishToWordPress.mockResolvedValue({ wpPostId: 1 } as any);
      const result = await controller.publishBulkArticles({ ids: ['1', '2'] } as any, undefined);
      expect(newsArticleService.publishToWordPress).toHaveBeenCalledTimes(2);
      expect(auditLogService.log).toHaveBeenCalledWith(AuditAction.BULK_PUBLISH, 'news_articles', ['1', '2'], 'system', { count: 2 });
      expect(result).toMatchObject({ message: 'Articles published to WordPress successfully' });
    });

    it('có key + cache hit → trả cached', async () => {
      const cached = { message: 'cached-bulk', data: [] };
      idempotencyService.get.mockReturnValue(cached);
      const result = await controller.publishBulkArticles({ ids: ['1'] } as any, 'bkey');
      expect(idempotencyService.get).toHaveBeenCalledWith('bulk:bkey');
      expect(newsArticleService.publishToWordPress).not.toHaveBeenCalled();
      expect(result).toBe(cached);
    });

    it('có key + in-flight → Conflict', async () => {
      idempotencyService.get.mockReturnValue(null);
      idempotencyService.isInFlight.mockReturnValue(true);
      await expect(controller.publishBulkArticles({ ids: ['1'] } as any, 'bkey')).rejects.toThrow(ConflictException);
    });

    it('có key, mới → markInFlight + set cache + clearInFlight', async () => {
      idempotencyService.get.mockReturnValue(null);
      idempotencyService.isInFlight.mockReturnValue(false);
      newsArticleService.publishToWordPress.mockResolvedValue({ wpPostId: 1 } as any);
      await controller.publishBulkArticles({ ids: ['1'] } as any, 'bkey');
      expect(idempotencyService.markInFlight).toHaveBeenCalledWith('bulk:bkey');
      expect(idempotencyService.set).toHaveBeenCalledWith('bulk:bkey', expect.any(Object));
      expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('bulk:bkey');
    });
  });

  describe('cleanArticle', () => {
    it('gọi service.cleanArticle(id) + trả { message, data }', async () => {
      newsArticleService.cleanArticle.mockResolvedValue({ _id: '1', content: 'clean' } as any);
      const result = await controller.cleanArticle('1');
      expect(newsArticleService.cleanArticle).toHaveBeenCalledWith('1');
      expect(result).toMatchObject({ message: 'Article cleaned successfully', data: { _id: '1', content: 'clean' } });
    });
  });

  describe('market analysis workflow (async, 5-step pipeline)', () => {
    /**
     * Fake in-memory job store để mô phỏng đúng hành vi thật của
     * AnalyzeJobService (getJob/updateJob mutate cùng 1 object reference) —
     * cần thiết vì `runWorkflow` đọc job.result, mutate rồi ghi lại qua updateJob.
     */
    let fakeJobs: Map<string, any>;

    beforeEach(() => {
      fakeJobs = new Map();
      analyzeJobService.createJob.mockImplementation(() => {
        const id = `job-${fakeJobs.size + 1}`;
        fakeJobs.set(id, { status: 'pending', updatedAt: Date.now() });
        return id;
      });
      analyzeJobService.getJob.mockImplementation((id: string) => fakeJobs.get(id));
      analyzeJobService.updateJob.mockImplementation((id: string, patch: any) => {
        const job = fakeJobs.get(id);
        if (job) Object.assign(job, patch, { updatedAt: Date.now() });
      });
      analyzeJobService.markDone.mockImplementation((id: string, result: unknown) => {
        fakeJobs.set(id, { status: 'done', result, updatedAt: Date.now() });
      });
      analyzeJobService.markError.mockImplementation((id: string, error: string) => {
        fakeJobs.set(id, { status: 'error', error, updatedAt: Date.now() });
      });
    });

    describe('POST /market-analysis-workflow', () => {
      it('trả { message, jobId }, markInFlight lock riêng + set state ban đầu pending', () => {
        const result = controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any);

        expect(idempotencyService.isInFlight).toHaveBeenCalledWith('workflow:market-analysis');
        expect(idempotencyService.markInFlight).toHaveBeenCalledWith('workflow:market-analysis');
        expect(result).toEqual({ message: 'Phân tích thị trường đã bắt đầu', jobId: expect.any(String) });

        // runWorkflow là async fire-and-forget: phần đồng bộ trước await đầu tiên
        // (updateStep(1, running)) đã chạy ngay trong cùng tick — đây là hành vi
        // JS chuẩn (async function chạy sync tới await đầu tiên), không phải bug.
        const job = fakeJobs.get(result.jobId);
        expect(job.status).toBe('pending');
        expect(job.result.steps).toHaveLength(5);
        expect(job.result.steps[0]).toMatchObject({ step: 1, status: 'running' });
        expect(job.result.date).toBe('2026-08-06');
      });

      it('không truyền date → dùng getTodayVNString() mặc định', () => {
        const result = controller.triggerMarketAnalysisWorkflow({} as any);
        const job = fakeJobs.get(result.jobId);
        expect(job.result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('lock đang in-flight → 409 ConflictException, KHÔNG tạo job', () => {
        idempotencyService.isInFlight.mockReturnValue(true);
        expect(() =>
          controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any),
        ).toThrow(ConflictException);
        expect(analyzeJobService.createJob).not.toHaveBeenCalled();
      });
    });

    describe('GET /market-analysis-workflow/:jobId', () => {
      it('jobId không tồn tại → { status: not_found }', () => {
        analyzeJobService.getJob.mockReturnValueOnce(undefined);
        expect(controller.getMarketAnalysisWorkflowJob('missing')).toEqual({ status: 'not_found' });
      });

      it('jobId tồn tại → trả state đã flatten (currentStep/steps/date ở top-level)', () => {
        fakeJobs.set('job-x', {
          status: 'pending',
          result: { currentStep: 2, steps: [{ step: 1, status: 'done' }], date: '2026-08-06' },
          updatedAt: 1,
        });
        expect(controller.getMarketAnalysisWorkflowJob('job-x')).toEqual({
          status: 'pending',
          currentStep: 2,
          steps: [{ step: 1, status: 'done' }],
          date: '2026-08-06',
        });
      });

      it('job status=done có finalResult → flatten ra field `result` top-level', () => {
        fakeJobs.set('job-y', {
          status: 'done',
          result: {
            currentStep: 5,
            steps: [],
            date: '2026-08-06',
            finalResult: { markdownContent: '# ok', newsArticleCount: 3, stats: { totalArticles: 5, filtered: 3, crawledContent: 3, failedCrawl: 0 } },
          },
        });
        const res: any = controller.getMarketAnalysisWorkflowJob('job-y');
        expect(res.result).toEqual({ markdownContent: '# ok', newsArticleCount: 3, stats: { totalArticles: 5, filtered: 3, crawledContent: 3, failedCrawl: 0 } });
        expect(res.status).toBe('done');
      });

      it('job status=error → giữ error + steps ở top-level (không mất progress)', () => {
        fakeJobs.set('job-z', {
          status: 'error',
          error: 'Firecrawl rate limit',
          result: { currentStep: 3, steps: [{ step: 3, status: 'error', error: 'Firecrawl rate limit' }], date: '2026-08-06' },
        });
        const res: any = controller.getMarketAnalysisWorkflowJob('job-z');
        expect(res.status).toBe('error');
        expect(res.error).toBe('Firecrawl rate limit');
        expect(res.steps).toEqual([{ step: 3, status: 'error', error: 'Firecrawl rate limit' }]);
      });
    });

    describe('runWorkflow — pipeline end-to-end (qua trigger)', () => {
      it('happy path: 5 bước chạy hết → markDone, steps đều done, audit log ghi', async () => {
        customCrawlerService.crawlData.mockResolvedValue({
          filePath: '/tmp/z.json',
          stats: { successfulSources: 1, failedSources: 0, totalArticles: 3 },
        } as any);
        customCrawlerService.getRawArticlesByDate.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
          { _id: { toString: () => 'r2' }, urlHash: 'h2' },
        ] as any);
        aiFilterService.filterRawArticles.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        customCrawlerService.deleteRawArticlesInSetNotIn.mockResolvedValue(undefined as any);
        customCrawlerService.getRawArticlesByIds.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        newsArticleService.saveArticles.mockResolvedValue({
          savedCount: 1, duplicates: 0,
          processedUrlHashes: ['h1'], newlySavedUrlHashes: ['h1'],
        } as any);
        customCrawlerService.deleteRawArticlesBulk.mockResolvedValue(undefined as any);
        newsArticleService.getArticleIdsByUrlHashes.mockResolvedValue(['a1']);
        newsArticleService.analyzeMarketBulk.mockResolvedValue({ processed: 1, failed: 0 } as any);
        newsArticleService.analyzeMarketTrendsByAI.mockResolvedValue('# Market report' as any);

        const { jobId } = controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        await new Promise(setImmediate);

        expect(customCrawlerService.crawlData).toHaveBeenCalledWith(undefined, '2026-08-06', '2026-08-06');
        expect(newsArticleService.analyzeMarketTrendsByAI).toHaveBeenCalledWith(['a1']);
        expect(analyzeJobService.markDone).toHaveBeenCalled();

        const job = fakeJobs.get(jobId);
        expect(job.status).toBe('done');
        expect(job.result.currentStep).toBe(5);
        expect(job.result.steps.every((s: any) => s.status === 'done')).toBe(true);
        // finalResult: markdownContent lấy đúng từ step 5, newsArticleCount đúng độ dài newsArticleIds
        expect(job.result.finalResult).toMatchObject({
          markdownContent: '# Market report',
          newsArticleCount: 1,
        });
        expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('workflow:market-analysis');
        expect(auditLogService.log).toHaveBeenCalledWith(
          AuditAction.WORKFLOW_MARKET_ANALYSIS,
          'news_articles',
          ['a1'],
          'system',
          expect.objectContaining({ jobId, date: '2026-08-06', articleCount: 1 }),
        );
      });

      it('ngày không có raw_articles → step 2-5 skip, markDone sớm', async () => {
        customCrawlerService.crawlData.mockResolvedValue({ filePath: '/tmp/e.json', stats: {} } as any);
        customCrawlerService.getRawArticlesByDate.mockResolvedValue([] as any);

        const { jobId } = controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any);
        await new Promise(setImmediate);
        await new Promise(setImmediate);

        expect(aiFilterService.filterRawArticles).not.toHaveBeenCalled();
        const job = fakeJobs.get(jobId);
        expect(job.status).toBe('done');
        expect(job.result.currentStep).toBe(5);
        expect(job.result.steps[1]).toMatchObject({ status: 'done', result: { filteredCount: 0 } });
      });

      it('AI filter trả rỗng → step 3-5 skip, markDone sớm', async () => {
        customCrawlerService.crawlData.mockResolvedValue({ filePath: '/tmp/f.json', stats: {} } as any);
        customCrawlerService.getRawArticlesByDate.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        aiFilterService.filterRawArticles.mockResolvedValue([] as any);
        customCrawlerService.deleteRawArticlesInSetNotIn.mockResolvedValue(undefined as any);

        const { jobId } = controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        await new Promise(setImmediate);

        expect(newsArticleService.saveArticles).not.toHaveBeenCalled();
        const job = fakeJobs.get(jobId);
        expect(job.status).toBe('done');
        expect(job.result.steps[2]).toMatchObject({ status: 'done', result: { savedCount: 0 } });
      });

      it('AI filter trả về object CHỈ có {urlHash, title} (đúng RAW_ARTICLES_PROMPT thật, KHÔNG có _id) → vẫn map ngược đúng qua allArticles để lấy _id cho step 3', async () => {
        customCrawlerService.crawlData.mockResolvedValue({ filePath: '/tmp/h.json', stats: { totalArticles: 2 } } as any);
        customCrawlerService.getRawArticlesByDate.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1', title: 'Tin 1' },
          { _id: { toString: () => 'r2' }, urlHash: 'h2', title: 'Tin 2' },
        ] as any);
        // AI chỉ trả urlHash + title — KHÔNG có _id, đúng RAW_ARTICLES_PROMPT thật.
        aiFilterService.filterRawArticles.mockResolvedValue([
          { urlHash: 'h1', title: 'Tin 1' },
        ] as any);
        customCrawlerService.deleteRawArticlesInSetNotIn.mockResolvedValue(undefined as any);
        customCrawlerService.getRawArticlesByIds.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        newsArticleService.saveArticles.mockResolvedValue({
          savedCount: 1, duplicates: 0,
          processedUrlHashes: ['h1'], newlySavedUrlHashes: ['h1'],
        } as any);
        customCrawlerService.deleteRawArticlesBulk.mockResolvedValue(undefined as any);
        newsArticleService.getArticleIdsByUrlHashes.mockResolvedValue(['a1']);
        newsArticleService.analyzeMarketBulk.mockResolvedValue({ processed: 1, failed: 0 } as any);
        newsArticleService.analyzeMarketTrendsByAI.mockResolvedValue('# report' as any);

        const { jobId } = controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        await new Promise(setImmediate);

        // rawIds phải map đúng từ allArticles (có _id) qua urlHash — KHÔNG rỗng.
        expect(customCrawlerService.getRawArticlesByIds).toHaveBeenCalledWith(['r1']);
        expect(newsArticleService.saveArticles).toHaveBeenCalled();
        const job = fakeJobs.get(jobId);
        expect(job.status).toBe('done');
        expect(job.result.finalResult.newsArticleCount).toBe(1);
      });

      it('lỗi giữa chừng (step 4 throw) → dừng pipeline, giữ nguyên steps tới bước lỗi, KHÔNG audit log, vẫn clearInFlight', async () => {
        customCrawlerService.crawlData.mockResolvedValue({ filePath: '/tmp/g.json', stats: {} } as any);
        customCrawlerService.getRawArticlesByDate.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        aiFilterService.filterRawArticles.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        customCrawlerService.deleteRawArticlesInSetNotIn.mockResolvedValue(undefined as any);
        customCrawlerService.getRawArticlesByIds.mockResolvedValue([
          { _id: { toString: () => 'r1' }, urlHash: 'h1' },
        ] as any);
        newsArticleService.saveArticles.mockResolvedValue({
          savedCount: 1, duplicates: 0,
          processedUrlHashes: ['h1'], newlySavedUrlHashes: ['h1'],
        } as any);
        customCrawlerService.deleteRawArticlesBulk.mockResolvedValue(undefined as any);
        newsArticleService.getArticleIdsByUrlHashes.mockResolvedValue(['a1']);
        newsArticleService.analyzeMarketBulk.mockRejectedValue(new Error('Firecrawl rate limit'));

        const { jobId } = controller.triggerMarketAnalysisWorkflow({ date: '2026-08-06' } as any);
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        await new Promise(setImmediate);

        // Hành vi mới: KHÔNG dùng markError trực tiếp (nó xoá result/steps) —
        // pipeline tự updateJob giữ nguyên steps + đánh dấu bước lỗi.
        expect(analyzeJobService.markError).not.toHaveBeenCalled();
        expect(newsArticleService.analyzeMarketTrendsByAI).not.toHaveBeenCalled();
        expect(auditLogService.log).not.toHaveBeenCalled();
        expect(idempotencyService.clearInFlight).toHaveBeenCalledWith('workflow:market-analysis');

        const job = fakeJobs.get(jobId);
        expect(job.status).toBe('error');
        expect(job.error).toBe('Firecrawl rate limit');
        // Steps 1-3 vẫn còn nguyên 'done', step 4 chuyển 'error' — KHÔNG mất progress.
        expect(job.result.steps[0].status).toBe('done');
        expect(job.result.steps[2].status).toBe('done');
        expect(job.result.steps[3]).toMatchObject({ status: 'error', error: 'Firecrawl rate limit' });
        expect(job.result.steps[4].status).toBe('pending');
      });
    });
  });

  describe('RBAC — @Roles metadata (mục 11 RBAC matrix)', () => {
    it.each([
      ['getPrompts', 'GET /news-manager/prompts'],
      ['updatePrompts', 'PUT /news-manager/prompts'],
      ['getCronConfig', 'GET /news-manager/cron'],
      ['updateCronConfig', 'POST /news-manager/cron'],
    ])('%s phải có @Roles(ADMIN)', (methodName) => {
      const method = (NewsFireCrawlManagerController.prototype as any)[methodName];
      const roles: UserRole[] = Reflect.getMetadata(ROLES_KEY, method);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.ADMIN);
    });

    it.each([
      ['triggerManualCrawl', 'POST /crawl'],
      ['publishArticle', 'POST /articles/:id/publish'],
      ['deleteBulkArticles', 'DELETE /articles bulk'],
      ['moveRawArticlesBulk', 'POST /raw-articles/move-bulk'],
    ])('%s không có @Roles restriction (EDITOR accessible)', (methodName) => {
      const method = (NewsFireCrawlManagerController.prototype as any)[methodName];
      const roles: UserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, method);
      expect(roles).toBeUndefined();
    });
  });
});
