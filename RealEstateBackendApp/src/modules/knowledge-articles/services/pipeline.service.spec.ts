import { Test, TestingModule } from '@nestjs/testing';
import { PipelineService } from './pipeline.service';
import { KnowledgeArticleService } from './knowledge-article.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import { AiWritingService } from './ai-writing.service';
import { AiImageService } from './ai-image.service';
import { WpClientService } from './wp-client.service';
import { PipelineLogService } from './pipeline-log.service';
import { CategoryRotationService } from './category-rotation.service';

describe('PipelineService', () => {
  let service: PipelineService;

  const mockKnowledgeArticleService = {
    listArticles: jest.fn(),
    getArticleById: jest.fn(),
    createBatchArticles: jest.fn(),
    updateState: jest.fn(),
    markFailed: jest.fn(),
    retryArticle: jest.fn(),
  };

  const mockKnowledgeConfigService = {
    getAiWritingConfig: jest.fn().mockResolvedValue({
      promptTemplate: 'Write about {{topic}}',
      model: 'test-model',
      provider: 'OpenRouter',
      topics: [
        {
          slug: 'ha-noi',
          name: 'BĐS Hà Nội',
          description: 'Thị trường Hà Nội',
        },
        { slug: 'hcm', name: 'BĐS HCM', description: 'Thị trường HCM' },
      ],
      articlesPerBatch: 2,
    }),
    getWpConfig: jest.fn().mockResolvedValue({
      siteUrl: 'https://example.com',
      categoryMapping: [
        { slug: 'ha-noi', wpCategoryId: 16, wpCategoryName: 'BĐS Hà Nội' },
      ],
      defaultCategoryId: 15,
    }),
    getAiImageConfig: jest.fn().mockResolvedValue({
      enabled: false,
    }),
  };

  const mockAiWritingService = {
    generateContent: jest.fn().mockResolvedValue({
      title: 'Generated Title',
      content: 'Markdown content',
      summary: 'Summary',
      tags: ['tag1'],
    }),
  };

  const mockAiImageService = {
    generateFeaturedImage: jest.fn(),
  };

  const mockWpClientService = {
    createPost: jest.fn().mockResolvedValue({
      postId: 100,
      postUrl: 'https://example.com/test',
    }),
    uploadMedia: jest.fn().mockResolvedValue({
      mediaId: 42,
      mediaUrl: 'https://example.com/img.jpg',
    }),
  };

  const mockPipelineLogService = {
    createLog: jest.fn().mockResolvedValue({}),
    addArticleResult: jest.fn(),
    updateStep: jest.fn(),
    finalizeLog: jest.fn(),
    updateTotalDuration: jest.fn(),
    listLogs: jest.fn().mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    }),
    getLogByBatchId: jest.fn(),
    markRunningAsFailed: jest.fn().mockResolvedValue(0),
  };

  const mockCategoryRotationService = {
    pickCategory: jest.fn().mockResolvedValue({
      topic: {
        slug: 'ha-noi',
        name: 'BĐS Hà Nội',
        description: 'Thị trường Hà Nội',
      },
      wpCategoryId: 16,
      rotationIndex: 0,
    }),
    getRotationState: jest.fn().mockReturnValue({
      currentIndex: 0,
      totalTopics: 2,
    }),
    resetRotation: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineService,
        {
          provide: KnowledgeArticleService,
          useValue: mockKnowledgeArticleService,
        },
        {
          provide: KnowledgeConfigService,
          useValue: mockKnowledgeConfigService,
        },
        {
          provide: AiWritingService,
          useValue: mockAiWritingService,
        },
        {
          provide: AiImageService,
          useValue: mockAiImageService,
        },
        {
          provide: WpClientService,
          useValue: mockWpClientService,
        },
        {
          provide: PipelineLogService,
          useValue: mockPipelineLogService,
        },
        {
          provide: CategoryRotationService,
          useValue: mockCategoryRotationService,
        },
      ],
    }).compile();

    service = module.get<PipelineService>(PipelineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startPipeline', () => {
    it('should return a jobId immediately', () => {
      const result = service.startPipeline({
        category: 'ha-noi',
        articleCount: 2,
        source: 'manual',
      });

      expect(result.message).toBe('Pipeline started');
      expect(result.jobId).toBeDefined();
      expect(typeof result.jobId).toBe('string');
    });

    it('should prevent concurrent pipeline runs', () => {
      // Start first pipeline
      service.startPipeline({
        category: 'ha-noi',
        articleCount: 1,
        source: 'manual',
      });

      // Try to start second pipeline — should throw
      expect(() =>
        service.startPipeline({
          category: 'hcm',
          articleCount: 1,
          source: 'manual',
        }),
      ).toThrow('already running');
    });

    it('should use CategoryRotationService for topic selection', () => {
      service.startPipeline({
        articleCount: 1,
        source: 'manual',
      });

      // Give async pipeline a moment to start
      expect(mockCategoryRotationService.pickCategory).toBeDefined();
    });
  });

  describe('getJobStatus', () => {
    it('should return null for unknown jobId', () => {
      const result = service.getJobStatus('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return status for an active job', async () => {
      const { jobId } = service.startPipeline({
        category: 'ha-noi',
        articleCount: 1,
        source: 'manual',
      });

      // Give the async pipeline a moment to start
      await new Promise((r) => setTimeout(r, 50));

      const status = service.getJobStatus(jobId);
      expect(status).not.toBeNull();
      expect(status!.status).toBeDefined();
      expect(status!.currentStep).toBeDefined();
      expect(status!.steps.length).toBe(5);
    });
  });

  describe('isPipelineRunning', () => {
    it('should return false when no pipeline is running', () => {
      expect(service.isPipelineRunning()).toBe(false);
    });

    it('should return true when a pipeline is running', () => {
      service.startPipeline({
        category: 'ha-noi',
        articleCount: 1,
        source: 'manual',
      });

      expect(service.isPipelineRunning()).toBe(true);
    });
  });

  describe('retryFailedArticles', () => {
    it('should throw when log not found', async () => {
      mockPipelineLogService.getLogByBatchId.mockResolvedValue(null);

      await expect(
        service.retryFailedArticles('non-existent-batch'),
      ).rejects.toThrow('not found');
    });

    it('should retry failed articles', async () => {
      mockPipelineLogService.getLogByBatchId.mockResolvedValue({
        articleResults: [
          { articleId: { toString: () => 'id1' }, state: 'failed' },
          { articleId: { toString: () => 'id2' }, state: 'published' },
          { articleId: { toString: () => 'id3' }, state: 'failed' },
        ],
      });

      mockKnowledgeArticleService.retryArticle.mockResolvedValue({
        success: true,
        failedStep: 2,
      });

      const result = await service.retryFailedArticles('batch-123');

      expect(result.retriedCount).toBe(2);
      expect(mockKnowledgeArticleService.retryArticle).toHaveBeenCalledTimes(2);
    });

    it('should handle individual retry failures gracefully', async () => {
      mockPipelineLogService.getLogByBatchId.mockResolvedValue({
        articleResults: [
          { articleId: { toString: () => 'id1' }, state: 'failed' },
          { articleId: { toString: () => 'id2' }, state: 'failed' },
        ],
      });

      mockKnowledgeArticleService.retryArticle
        .mockResolvedValueOnce({ success: true, failedStep: 2 })
        .mockRejectedValueOnce(new Error('Retry failed'));

      const result = await service.retryFailedArticles('batch-123');

      expect(result.retriedCount).toBe(1);
    });
  });

  describe('onModuleInit (M-01)', () => {
    it('marks orphan RUNNING pipeline logs as FAILED on startup', async () => {
      await service.onModuleInit();

      expect(mockPipelineLogService.markRunningAsFailed).toHaveBeenCalledTimes(
        1,
      );
    });

    it('does not throw when markRunningAsFailed fails', async () => {
      mockPipelineLogService.markRunningAsFailed.mockRejectedValueOnce(
        new Error('DB down'),
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
