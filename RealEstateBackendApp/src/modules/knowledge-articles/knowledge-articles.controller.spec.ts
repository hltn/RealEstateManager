/**
 * KnowledgeArticlesController unit tests.
 *
 * Tests all controller methods by mocking the underlying services.
 */

import { KnowledgeArticlesController } from './knowledge-articles.controller';
import { KnowledgeArticleService } from './services/knowledge-article.service';
import { KnowledgeConfigService } from './services/knowledge-config.service';
import { PipelineLogService } from './services/pipeline-log.service';
import { PipelineService } from './services/pipeline.service';
import { NlCronService } from './services/nl-cron.service';
import { AiImageService } from './services/ai-image.service';
import { WpClientService } from './services/wp-client.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { AuditLogService } from '../news-fire-crawl-manager/services/audit-log.service';

describe('KnowledgeArticlesController', () => {
  let controller: KnowledgeArticlesController;
  let mockArticleService: jest.Mocked<KnowledgeArticleService>;
  let mockConfigService: jest.Mocked<KnowledgeConfigService>;
  let mockLogService: jest.Mocked<PipelineLogService>;
  let mockPipelineService: jest.Mocked<PipelineService>;
  let mockNlCronService: jest.Mocked<NlCronService>;
  let mockAiImageService: jest.Mocked<AiImageService>;
  let mockWpClientService: jest.Mocked<WpClientService>;
  let mockIdempotencyService: jest.Mocked<IdempotencyService>;
  let mockAuditLogService: jest.Mocked<AuditLogService>;

  beforeEach(() => {
    mockArticleService = {
      listArticles: jest.fn(),
      getArticleById: jest.fn(),
      deleteArticle: jest.fn(),
      deleteBulkArticles: jest.fn(),
      updateState: jest.fn(),
      markFailed: jest.fn(),
      retryArticle: jest.fn(),
      publishToWordPress: jest.fn(),
      republishToWordPress: jest.fn(),
      createBatchArticles: jest.fn(),
    } as unknown as jest.Mocked<KnowledgeArticleService>;

    mockConfigService = {
      getConfig: jest.fn(),
      updateConfig: jest.fn(),
      getWpConfig: jest.fn(),
      updateWpConfig: jest.fn(),
      getAiWritingConfig: jest.fn(),
      updateAiWritingConfig: jest.fn(),
      getAiImageConfig: jest.fn(),
      updateAiImageConfig: jest.fn(),
      getCronConfig: jest.fn(),
      updateCronConfig: jest.fn(),
    } as unknown as jest.Mocked<KnowledgeConfigService>;

    mockLogService = {
      createLog: jest.fn(),
      addArticleResult: jest.fn(),
      updateStep: jest.fn(),
      finalizeLog: jest.fn(),
      listLogs: jest.fn(),
      getLogByBatchId: jest.fn(),
    } as unknown as jest.Mocked<PipelineLogService>;

    mockPipelineService = {
      startPipeline: jest.fn(),
      getJobStatus: jest.fn(),
      retryFailedArticles: jest.fn(),
    } as unknown as jest.Mocked<PipelineService>;

    mockNlCronService = {
      parseDescription: jest.fn(),
      previewSchedule: jest.fn(),
      activateSchedule: jest.fn(),
      deactivateSchedule: jest.fn(),
      initFromConfig: jest.fn(),
    } as unknown as jest.Mocked<NlCronService>;

    mockAiImageService = {
      generateFeaturedImage: jest.fn(),
      generateInlineImages: jest.fn(),
      testGenerate: jest.fn(),
    } as unknown as jest.Mocked<AiImageService>;

    mockWpClientService = {
      verifyConnection: jest.fn(),
    } as unknown as jest.Mocked<WpClientService>;

    mockIdempotencyService = {
      get: jest.fn(),
      set: jest.fn(),
      isInFlight: jest.fn().mockReturnValue(false),
      markInFlight: jest.fn(),
      clearInFlight: jest.fn(),
    } as unknown as jest.Mocked<IdempotencyService>;

    mockAuditLogService = {
      log: jest.fn(),
    } as unknown as jest.Mocked<AuditLogService>;

    controller = new KnowledgeArticlesController(
      mockArticleService,
      mockConfigService,
      mockLogService,
      mockPipelineService,
      mockNlCronService,
      mockAiImageService,
      mockWpClientService,
      mockIdempotencyService,
      mockAuditLogService,
    );
  });

  // ── Config Endpoints ──────────────────────────────────

  describe('getWpConfig', () => {
    it('returns config data with appPassword masked', async () => {
      mockConfigService.getWpConfig.mockResolvedValue({
        siteUrl: 'https://test.com',
        appPassword: 'real-secret',
      });

      const result = await controller.getWpConfig();

      expect(result).toEqual({
        data: { siteUrl: 'https://test.com', appPassword: '***' },
      });
    });

    it('does not add appPassword field when absent', async () => {
      mockConfigService.getWpConfig.mockResolvedValue({
        siteUrl: 'https://test.com',
      });

      const result = await controller.getWpConfig();

      expect(result.data).toEqual({ siteUrl: 'https://test.com' });
      expect(result.data.appPassword).toBeUndefined();
    });
  });

  describe('updateWpConfig', () => {
    it('updates config and returns message + data', async () => {
      mockConfigService.updateWpConfig.mockResolvedValue({
        type: 'wp_connection' as never,
        config: { siteUrl: 'https://new.com' },
      } as never);

      const result = await controller.updateWpConfig({
        siteUrl: 'https://new.com',
      });

      expect(result.message).toBe('WP config updated');
      expect(result.data).toEqual({ siteUrl: 'https://new.com' });
    });

    // M-04: masked password must not overwrite real credential in DB
    it('strips masked appPassword (*** ) before passing to config service', async () => {
      mockConfigService.updateWpConfig.mockResolvedValue({
        type: 'wp_connection' as never,
        config: { siteUrl: 'https://old.com', appPassword: 'real-pw' },
      } as never);

      await controller.updateWpConfig({
        siteUrl: 'https://old.com',
        appPassword: '***' as never,
      });

      // The config service must receive payload WITHOUT appPassword
      const passedPayload = mockConfigService.updateWpConfig.mock.calls[0][0];
      expect(passedPayload).not.toHaveProperty('appPassword');
    });

    it('strips empty appPassword string before passing to config service', async () => {
      mockConfigService.updateWpConfig.mockResolvedValue({
        type: 'wp_connection' as never,
        config: {},
      } as never);

      await controller.updateWpConfig({
        siteUrl: 'https://old.com',
        appPassword: '' as never,
      });

      const passedPayload = mockConfigService.updateWpConfig.mock.calls[0][0];
      expect(passedPayload).not.toHaveProperty('appPassword');
    });

    it('passes real appPassword through when user actually changes it', async () => {
      mockConfigService.updateWpConfig.mockResolvedValue({
        type: 'wp_connection' as never,
        config: { appPassword: 'new-real-pw' },
      } as never);

      await controller.updateWpConfig({
        appPassword: 'new-real-pw' as never,
      });

      const passedPayload = mockConfigService.updateWpConfig.mock.calls[0][0];
      expect(passedPayload.appPassword).toBe('new-real-pw');
    });
  });

  describe('verifyWpConnection', () => {
    it('delegates to WpClientService and returns result', async () => {
      mockWpClientService.verifyConnection.mockResolvedValue({
        valid: true,
        siteName: 'Test WP Site',
      });

      const result = await controller.verifyWpConnection();

      expect(result).toEqual({
        data: { valid: true, siteName: 'Test WP Site' },
      });
      expect(mockWpClientService.verifyConnection).toHaveBeenCalled();
    });

    it('returns error info when connection fails', async () => {
      mockWpClientService.verifyConnection.mockResolvedValue({
        valid: false,
        error: 'Connection refused',
      });

      const result = await controller.verifyWpConnection();

      expect(result).toEqual({
        data: { valid: false, error: 'Connection refused' },
      });
    });
  });

  describe('getAiWritingConfig', () => {
    it('returns AI writing config', async () => {
      mockConfigService.getAiWritingConfig.mockResolvedValue({
        promptTemplate: 'test',
      });

      const result = await controller.getAiWritingConfig();

      expect(result).toEqual({ data: { promptTemplate: 'test' } });
    });
  });

  describe('updateAiWritingConfig', () => {
    it('updates and returns message', async () => {
      mockConfigService.updateAiWritingConfig.mockResolvedValue({
        config: { promptTemplate: 'new' },
      } as never);

      const result = await controller.updateAiWritingConfig({
        promptTemplate: 'new',
      });

      expect(result.message).toBe('AI writing config updated');
    });
  });

  describe('getAiImageConfig', () => {
    it('returns AI image config', async () => {
      mockConfigService.getAiImageConfig.mockResolvedValue({
        enabled: true,
      });

      const result = await controller.getAiImageConfig();

      expect(result).toEqual({ data: { enabled: true } });
    });
  });

  describe('updateAiImageConfig', () => {
    it('updates and returns message', async () => {
      mockConfigService.updateAiImageConfig.mockResolvedValue({
        config: { enabled: false },
      } as never);

      const result = await controller.updateAiImageConfig({
        enabled: false,
      });

      expect(result.message).toBe('AI image config updated');
    });
  });

  describe('testAiImageGeneration', () => {
    it('delegates to AiImageService and returns imageUrl', async () => {
      mockAiImageService.testGenerate.mockResolvedValue({
        imageUrl: 'https://example.com/test.png',
      });

      const result = await controller.testAiImageGeneration();

      expect(result).toEqual({
        data: { imageUrl: 'https://example.com/test.png' },
      });
      expect(mockAiImageService.testGenerate).toHaveBeenCalled();
    });
  });

  describe('getCronConfig', () => {
    it('returns cron config', async () => {
      mockConfigService.getCronConfig.mockResolvedValue({
        isActive: true,
      });

      const result = await controller.getCronConfig();

      expect(result).toEqual({ data: { isActive: true } });
    });
  });

  describe('updateCronConfig', () => {
    it('updates and returns message', async () => {
      mockConfigService.updateCronConfig.mockResolvedValue({
        config: { isActive: false },
      } as never);

      const result = await controller.updateCronConfig({
        isActive: false,
      });

      expect(result.message).toBe('Cron config updated');
    });
  });

  // ── Article Endpoints ──────────────────────────────────

  describe('getKnowledgeArticles', () => {
    it('returns paginated articles', async () => {
      mockArticleService.listArticles.mockResolvedValue({
        data: [{ title: 'Test' }] as never[],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const result = await controller.getKnowledgeArticles({});

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getKnowledgeArticleById', () => {
    it('returns article detail', async () => {
      mockArticleService.getArticleById.mockResolvedValue({
        _id: 'abc',
        title: 'Test',
      } as never);

      const result = await controller.getKnowledgeArticleById('abc');

      expect(result.data).toEqual({ _id: 'abc', title: 'Test' });
    });
  });

  describe('retryArticle', () => {
    it('retries and returns result', async () => {
      mockArticleService.retryArticle.mockResolvedValue({
        success: true,
        failedStep: 2,
      });

      const result = await controller.retryArticle('abc');

      expect(result.message).toBe('Retry initiated');
      expect(result.data).toEqual({ success: true, failedStep: 2 });
    });
  });

  describe('publishArticle', () => {
    it('publishes and returns wpPostId', async () => {
      mockArticleService.publishToWordPress.mockResolvedValue({
        wpPostId: 123,
      });

      const result = await controller.publishArticle('abc');

      expect((result as any).message).toBe('Article published');
      expect((result as any).data).toEqual({ wpPostId: 123 });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.any(String),
        'news_articles',
        ['abc'],
        'system',
        { wpPostId: 123 },
      );
    });

    it('returns in-progress message when idempotency key is in flight', async () => {
      mockIdempotencyService.isInFlight.mockReturnValue(true);

      const result = await controller.publishArticle('abc', 'key-1');

      expect(result).toEqual({ message: 'Request already in progress' });
    });
  });

  describe('republishArticle', () => {
    it('republishes and returns wpPostId', async () => {
      mockArticleService.republishToWordPress.mockResolvedValue({
        wpPostId: 456,
      });

      const result = await controller.republishArticle('abc');

      expect((result as any).message).toBe('Article republished');
      expect((result as any).data).toEqual({ wpPostId: 456 });
      expect(mockAuditLogService.log).toHaveBeenCalled();
    });
  });

  describe('deleteKnowledgeArticle', () => {
    it('deletes and returns message', async () => {
      mockArticleService.deleteArticle.mockResolvedValue(undefined);

      const result = await controller.deleteKnowledgeArticle('abc');

      expect(result.message).toBe('Article deleted');
      expect(mockAuditLogService.log).toHaveBeenCalled();
    });
  });

  describe('bulkDeleteArticles', () => {
    it('bulk deletes and returns count', async () => {
      mockArticleService.deleteBulkArticles.mockResolvedValue({
        deletedCount: 2,
      });

      const result = await controller.bulkDeleteArticles({
        ids: ['id1', 'id2'],
      });

      expect((result as any).message).toBe('2 articles deleted');
      expect((result as any).data).toEqual({ deletedCount: 2 });
      expect(mockAuditLogService.log).toHaveBeenCalled();
    });
  });

  // ── Pipeline Endpoints ────────────────────────────────

  describe('startPipeline', () => {
    it('delegates to PipelineService and returns jobId', async () => {
      mockPipelineService.startPipeline.mockReturnValue({
        message: 'Pipeline started',
        jobId: 'test-uuid-123',
      });

      const result = await controller.startPipeline();

      expect(result.message).toBe('Pipeline started');
      expect(result.jobId).toBe('test-uuid-123');
      expect(mockPipelineService.startPipeline).toHaveBeenCalledWith({
        category: undefined,
        articleCount: undefined,
        source: 'manual',
      });
    });
  });

  describe('getPipelineStatus', () => {
    it('returns status for active job', async () => {
      mockPipelineService.getJobStatus.mockReturnValue({
        status: 'running',
        currentStep: 2,
        steps: [],
      });

      const result = await controller.getPipelineStatus('job-123');

      expect(result.status).toBe('running');
      expect(result.currentStep).toBe(2);
    });

    it('returns not_found for unknown job', async () => {
      mockPipelineService.getJobStatus.mockReturnValue(null);

      const result = await controller.getPipelineStatus('unknown');

      expect(result.status).toBe('not_found');
    });
  });

  describe('getPipelineLogs', () => {
    it('delegates to PipelineLogService', async () => {
      mockLogService.listLogs.mockResolvedValue({
        data: [
          {
            batchId: 'b1',
            categorySlug: 'ha-noi',
            source: 'manual',
            status: 'completed' as never,
          } as never,
        ],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const result = await controller.getPipelineLogs({
        page: 1,
        limit: 20,
      });

      expect(mockLogService.listLogs).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        status: undefined,
        category: undefined,
      });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getPipelineLogDetail', () => {
    it('returns log detail', async () => {
      mockLogService.getLogByBatchId.mockResolvedValue({
        batchId: 'batch-1',
        status: 'completed' as never,
      } as never);

      const result = await controller.getPipelineLogDetail('batch-1');

      expect(result.data).toEqual({
        batchId: 'batch-1',
        status: 'completed',
      });
    });

    it('returns null when log not found', async () => {
      mockLogService.getLogByBatchId.mockResolvedValue(null);

      const result = await controller.getPipelineLogDetail('missing');

      expect(result.data).toBeNull();
    });
  });

  // ── NL Cron Endpoints ─────────────────────────────────

  describe('parseNlSchedule', () => {
    it('delegates to NlCronService', async () => {
      mockNlCronService.parseDescription.mockResolvedValue({
        cronExpression: '0 8 * * 1-5',
        explanation: 'Weekdays at 8am',
        schedule: { frequency: 'weekdays', time: '08:00', timezone: 'Asia/Ho_Chi_Minh' },
        articlesPerBatch: 3,
        categories: [],
      });

      const result = await controller.parseNlSchedule({
        description: 'Run daily at 8am weekdays',
      });

      expect(result.cronExpression).toBe('0 8 * * 1-5');
      expect(result.explanation).toBe('Weekdays at 8am');
      expect(mockNlCronService.parseDescription).toHaveBeenCalledWith('Run daily at 8am weekdays');
    });
  });

  describe('previewSchedule', () => {
    it('delegates to NlCronService', async () => {
      mockNlCronService.previewSchedule.mockReturnValue({
        nextRuns: ['2026-08-17T01:00:00.000Z', '2026-08-18T01:00:00.000Z'],
      });

      const result = await controller.previewSchedule({
        cronExpression: '0 8 * * 1-5',
      });

      expect(result.nextRuns).toHaveLength(2);
    });
  });

  describe('activateSchedule', () => {
    it('delegates to NlCronService', async () => {
      mockNlCronService.activateSchedule.mockResolvedValue({
        message: 'Cron schedule activated successfully',
        nextRuns: ['2026-08-17T01:00:00.000Z'],
      });

      const result = await controller.activateSchedule({
        cronExpression: '0 8 * * 1-5',
        nlDescription: 'Daily at 8am weekdays',
      });

      expect(result.message).toBe('Cron schedule activated successfully');
      expect(mockNlCronService.activateSchedule).toHaveBeenCalledWith(
        '0 8 * * 1-5',
        'Daily at 8am weekdays',
      );
    });
  });

  describe('testRun', () => {
    it('delegates to PipelineService', async () => {
      mockPipelineService.startPipeline.mockReturnValue({
        message: 'Pipeline started',
        jobId: 'test-run-uuid',
      });

      const result = await controller.testRun();

      expect(result.message).toBe('Pipeline started');
      expect(result.jobId).toBe('test-run-uuid');
      expect(mockPipelineService.startPipeline).toHaveBeenCalledWith({
        category: undefined,
        articleCount: undefined,
        source: 'manual',
      });
    });
  });
});
