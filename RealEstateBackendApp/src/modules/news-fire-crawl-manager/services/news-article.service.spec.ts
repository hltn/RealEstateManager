jest.mock('jsdom', () => ({}));
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { NewsArticleService } from './news-article.service';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import { RawArticle } from '../schemas/raw-article.schema';
import { MarketAnalysisHistory } from '../schemas/market-analysis-history.schema';
import { WordPressService } from './wordpress.service';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { EmbeddingService } from './embedding.service';
import { ArticleExtractorUtil } from '../../../utils/article-extractor.util';

/** Tao chainable query mock: find(query).sort().skip().limit().exec() -> data */
function chainableFind(data: any) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnThis();
  chain.skip = jest.fn().mockReturnThis();
  chain.limit = jest.fn().mockReturnThis();
  chain.select = jest.fn().mockReturnThis();
  chain.lean = jest.fn().mockReturnThis();
  chain.exec = jest.fn().mockResolvedValue(data);
  return chain;
}

describe('NewsArticleService', () => {
  let service: NewsArticleService;
  let mockNewsArticleModel: any;
  let mockRawArticleModel: any;
  let mockMarketAnalysisHistoryModel: any;
  let mockAiFilterService: any;
  let mockEmbeddingService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockNewsArticleModel = {
      updateMany: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockRawArticleModel = {
      updateOne: jest.fn(),
      find: jest.fn(),
    };

    mockMarketAnalysisHistoryModel = { find: jest.fn() };
    mockAiFilterService = {
      cleanMarkdownContentWithAI: jest.fn(),
    };

    mockEmbeddingService = {
      createEmbedding: jest.fn(),
      createEmbeddingBatch: jest.fn(),
      prepareEmbeddingInput: jest.fn().mockReturnValue('test input'),
      getEmbeddingModelName: jest.fn().mockReturnValue('openai/text-embedding-3-small'),
      getEmbeddingDimensions: jest.fn().mockReturnValue(512),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, string> = {
          DEDUP_THRESHOLD: '0.90',
          DEDUP_WINDOW_DAYS: '30',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsArticleService,
        {
          provide: getModelToken(NewsArticle.name),
          useValue: mockNewsArticleModel,
        },
        {
          provide: getModelToken(RawArticle.name),
          useValue: mockRawArticleModel,
        },
        {
          provide: getModelToken(MarketAnalysisHistory.name),
          useValue: mockMarketAnalysisHistoryModel,
        },
        {
          provide: WordPressService,
          useValue: {},
        },
        {
          provide: AIFilterService,
          useValue: mockAiFilterService,
        },
        {
          provide: AiPromptConfigService,
          useValue: {},
        },
        {
          provide: EmbeddingService,
          useValue: mockEmbeddingService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<NewsArticleService>(NewsArticleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanupUncontentCrawledStatus', () => {
    it('should call updateMany to remove CRAWLED status from articles without valid content', async () => {
      mockNewsArticleModel.updateMany.mockResolvedValue({ modifiedCount: 15 });

      const result = await service.cleanupUncontentCrawledStatus();

      expect(mockNewsArticleModel.updateMany).toHaveBeenCalledWith(
        {
          $or: [
            { content: { $exists: false } },
            { content: null },
            { content: { $regex: /^\s*$/ } },
          ],
          status: NewsStatus.CRAWLED,
        },
        {
          $pull: { status: NewsStatus.CRAWLED },
        },
      );
      expect(result).toEqual({ modifiedCount: 15 });
    });
  });

  describe('onModuleInit', () => {
    it('should call cleanupUncontentCrawledStatus on module init', async () => {
      jest
        .spyOn(service, 'cleanupUncontentCrawledStatus')
        .mockResolvedValue({ modifiedCount: 5 });

      await service.onModuleInit();

      expect(service.cleanupUncontentCrawledStatus).toHaveBeenCalled();
    });
  });

  describe('cleanArticle', () => {
    it('should throw NotFoundException if article is not found', async () => {
      mockNewsArticleModel.findById.mockResolvedValue(null);

      await expect(service.cleanArticle('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should crawl article if content is empty, update thumbnail and publishDate, clean content with AI, set CRAWLED status and save', async () => {
      const mockArticle: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: '',
        thumbnailUrl: '',
        publishDate: '',
        status: [],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticle);

      const extractSpy = jest
        .spyOn(ArticleExtractorUtil, 'extractArticle')
        .mockResolvedValue({
          markdown: 'Raw Crawled Markdown',
          thumbnailUrl: 'https://example.com/image.jpg',
          publishDate: '2026-07-25T00:00:00.000Z',
        });

      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue(
        'Cleaned Markdown AI',
      );

      const result = await service.cleanArticle('123');

      expect(extractSpy).toHaveBeenCalledWith('https://example.com/news/1');
      expect(mockArticle.thumbnailUrl).toBe('https://example.com/image.jpg');
      expect(mockArticle.publishDate).toBe('2026-07-25T00:00:00.000Z');
      expect(mockArticle.content).toBe('Cleaned Markdown AI');
      expect(mockArticle.status).toContain(NewsStatus.CRAWLED);
      expect(mockArticle.save).toHaveBeenCalled();
      expect(result).toBe(mockArticle);

      extractSpy.mockRestore();
    });

    it('should clean existing content with AI if content is already present', async () => {
      const mockArticle: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: 'Existing Markdown Content',
        status: [],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticle);

      const extractSpy = jest.spyOn(ArticleExtractorUtil, 'extractArticle');
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue(
        'Cleaned Existing Markdown',
      );

      const result = await service.cleanArticle('123');

      expect(extractSpy).not.toHaveBeenCalled();
      expect(mockArticle.content).toBe('Cleaned Existing Markdown');
      expect(mockArticle.status).toContain(NewsStatus.CRAWLED);
      expect(mockArticle.save).toHaveBeenCalled();
      expect(result).toBe(mockArticle);

      extractSpy.mockRestore();
    });

    it('should retain raw extracted markdown content as fallback if AI cleanup fails', async () => {
      const mockArticle: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: '',
        status: [],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticle);

      const extractSpy = jest
        .spyOn(ArticleExtractorUtil, 'extractArticle')
        .mockResolvedValue({
          markdown: 'Raw Crawled Markdown',
        });

      mockAiFilterService.cleanMarkdownContentWithAI.mockRejectedValue(
        new Error('AI Service Error'),
      );

      const result = await service.cleanArticle('123');

      expect(mockArticle.content).toBe('Raw Crawled Markdown');
      expect(mockArticle.status).toContain(NewsStatus.CRAWLED);
      expect(mockArticle.save).toHaveBeenCalled();
      expect(result).toBe(mockArticle);

      extractSpy.mockRestore();
    });

    it('should normalize legacy status string to array and preserve valid status', async () => {
      const mockArticle: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: 'Some article content',
        status: NewsStatus.POSTED_WP,
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticle);
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue(
        'Cleaned content',
      );

      await service.cleanArticle('123');

      expect(mockArticle.status).toEqual([
        NewsStatus.POSTED_WP,
        NewsStatus.CRAWLED,
      ]);
    });

    it('should filter out invalid status strings when normalizing status', async () => {
      const mockArticle: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: 'Some article content',
        status: 'INVALID_STATUS_STRING',
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticle);
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue(
        'Cleaned content',
      );

      await service.cleanArticle('123');

      expect(mockArticle.status).toEqual([NewsStatus.CRAWLED]);
    });

    it('should validate and set valid publishDate from extraction, falling back to current ISO date if invalid', async () => {
      const mockArticleValid: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: '',
        publishDate: 'Invalid Date',
        status: [],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticleValid);

      const extractSpyValid = jest
        .spyOn(ArticleExtractorUtil, 'extractArticle')
        .mockResolvedValue({
          markdown: 'Content',
          publishDate: '2026-06-15T10:00:00Z',
        });
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue(
        'Content',
      );

      await service.cleanArticle('123');
      expect(mockArticleValid.publishDate).toBe(
        new Date('2026-06-15T10:00:00Z').toISOString(),
      );
      extractSpyValid.mockRestore();

      // Test with invalid extracted date
      const mockArticleInvalid: any = {
        _id: '456',
        url: 'https://example.com/news/2',
        content: '',
        publishDate: '',
        status: [],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticleInvalid);
      const extractSpyInvalid = jest
        .spyOn(ArticleExtractorUtil, 'extractArticle')
        .mockResolvedValue({
          markdown: 'Content',
          publishDate: 'not-a-valid-date-string',
        });
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue(
        'Content',
      );

      await service.cleanArticle('456');
      expect(mockArticleInvalid.publishDate).toBeDefined();
      expect(isNaN(new Date(mockArticleInvalid.publishDate).getTime())).toBe(
        false,
      );
      extractSpyInvalid.mockRestore();
    });

    it('should filter OUT CRAWLED status when content is empty and handle extraction failure', async () => {
      const mockArticle: any = {
        _id: '123',
        url: 'https://example.com/news/1',
        content: '',
        status: [NewsStatus.POSTED_WP, NewsStatus.CRAWLED],
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockNewsArticleModel.findById.mockResolvedValue(mockArticle);

      const extractSpy = jest
        .spyOn(ArticleExtractorUtil, 'extractArticle')
        .mockRejectedValue(new Error('Extraction Failed'));

      const result = await service.cleanArticle('123');

      expect(mockArticle.status).not.toContain(NewsStatus.CRAWLED);
      expect(mockArticle.status).toEqual([NewsStatus.POSTED_WP]);
      expect(mockArticle.save).toHaveBeenCalled();
      expect(result).toBe(mockArticle);

      extractSpy.mockRestore();
    });
  });

  describe('getMarketAnalysisHistory', () => {
    it('returns ten newest records and an opaque cursor when another page exists', async () => {
      const records = Array.from({ length: 11 }, (_, index) => ({
        _id: (index + 1).toString(16).padStart(24, '0'),
        createdAt: new Date(Date.UTC(2026, 7, 12, 10, 0, 0, -index)),
      }));
      const query = chainableFind(records);
      mockMarketAnalysisHistoryModel.find.mockReturnValue(query);

      const result = await service.getMarketAnalysisHistory();

      expect(mockMarketAnalysisHistoryModel.find).toHaveBeenCalledWith({});
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(query.limit).toHaveBeenCalledWith(11);
      expect(result.data).toEqual(records.slice(0, 10));
      expect(result.meta).toMatchObject({
        limit: 10,
        hasMore: true,
        nextCursor: expect.any(String),
      });
    });

    it('uses createdAt and _id as a stable exclusive cursor boundary', async () => {
      const anchorId = '507f1f77bcf86cd799439011';
      const anchorDate = new Date('2026-08-12T10:00:00.000Z');
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: anchorDate.toISOString(), id: anchorId }),
      ).toString('base64url');
      mockMarketAnalysisHistoryModel.find.mockReturnValue(chainableFind([]));

      await service.getMarketAnalysisHistory(cursor);

      expect(mockMarketAnalysisHistoryModel.find).toHaveBeenCalledWith({
        $or: [
          { createdAt: { $lt: anchorDate } },
          { createdAt: anchorDate, _id: { $lt: expect.anything() } },
        ],
      });
    });

    it('rejects a malformed cursor before querying MongoDB', async () => {
      await expect(
        service.getMarketAnalysisHistory('not-a-cursor'),
      ).rejects.toThrow('Invalid market analysis history cursor');
      expect(mockMarketAnalysisHistoryModel.find).not.toHaveBeenCalled();
    });
  });

  describe('getSavedArticles', () => {
    it('date -> query loc theo publishDate/createdAt dung dung moc UTC quy doi tu gio Viet Nam (offset +7)', async () => {
      mockNewsArticleModel.find.mockReturnValue(chainableFind([]));
      mockNewsArticleModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.getSavedArticles('2026-08-05', undefined, 1, 20);

      const query = mockNewsArticleModel.find.mock.calls[0][0];
      const expectedStart = '2026-08-04T17:00:00.000Z';
      const expectedEnd = '2026-08-05T16:59:59.999Z';

      expect(query.$or[0].publishDate.$gte).toBe(expectedStart);
      expect(query.$or[0].publishDate.$lte).toBe(expectedEnd);
      expect(query.$or[1].$and[1].createdAt.$gte.toISOString()).toBe(
        expectedStart,
      );
      expect(query.$or[1].$and[1].createdAt.$lte.toISOString()).toBe(
        expectedEnd,
      );

      const boundaryArticlePublishedAt = new Date(
        '2026-08-04T23:54:02.000Z',
      );
      expect(boundaryArticlePublishedAt.getTime()).toBeGreaterThanOrEqual(
        new Date(expectedStart).getTime(),
      );
      expect(boundaryArticlePublishedAt.getTime()).toBeLessThanOrEqual(
        new Date(expectedEnd).getTime(),
      );
    });

    it('loc status=POSTED_WP, roi dem toan bo 30 record truoc khi phan trang trang 2', async () => {
      const records = Array.from({ length: 10 }, (_, index) => ({
        _id: `article-${index + 21}`,
      }));
      const findQuery = chainableFind(records);
      mockNewsArticleModel.find.mockReturnValue(findQuery);
      mockNewsArticleModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(30),
      });

      const result = await service.getSavedArticles(
        undefined,
        NewsStatus.POSTED_WP,
        2,
        20,
      );

      expect(mockNewsArticleModel.find).toHaveBeenCalledWith({
        status: NewsStatus.POSTED_WP,
      });
      expect(findQuery.skip).toHaveBeenCalledWith(20);
      expect(findQuery.limit).toHaveBeenCalledWith(20);
      expect(mockNewsArticleModel.countDocuments).toHaveBeenCalledWith({
        status: NewsStatus.POSTED_WP,
      });
      expect(result).toEqual({ data: records, total: 30 });
      expect(result.data).toHaveLength(10);
    });

    it('status=pending match cac bai khong co status, null, hoac mang rong', async () => {
      mockNewsArticleModel.find.mockReturnValue(chainableFind([]));
      mockNewsArticleModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.getSavedArticles(undefined, 'pending', 1, 20);

      expect(mockNewsArticleModel.find).toHaveBeenCalledWith({
        $or: [
          { status: { $exists: false } },
          { status: null },
          { status: { $size: 0 } },
        ],
      });
      expect(mockNewsArticleModel.countDocuments).toHaveBeenCalledWith(
        mockNewsArticleModel.find.mock.calls[0][0],
      );
    });
  });

  // ── DEDUP TESTS ──

  describe('checkDuplicate', () => {
    it('should return false when no candidates exist', async () => {
      mockNewsArticleModel.find.mockReturnValue(chainableFind([]));

      const result = await service.checkDuplicate(
        [0.1, 0.2, 0.3],
        '2026-08-14T00:00:00.000Z',
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateOf).toBeNull();
      expect(result.duplicateScore).toBeNull();
    });

    it('should return false when candidates exist but score < threshold', async () => {
      mockNewsArticleModel.find.mockReturnValue(
        chainableFind([
          { _id: 'abc123', contentEmbedding: [0.9, 0.0, 0.0], title: 'Test' },
        ]),
      );

      const result = await service.checkDuplicate(
        [0.0, 0.9, 0.0],
        '2026-08-14T00:00:00.000Z',
      );

      expect(result.isDuplicate).toBe(false);
    });

    it('should return true when score >= threshold', async () => {
      const sharedEmbedding = [0.5, 0.5, 0.5];
      mockNewsArticleModel.find.mockReturnValue(
        chainableFind([
          { _id: 'abc123', contentEmbedding: sharedEmbedding, title: 'Original' },
        ]),
      );

      // Identical vector => score = 1.0 >= 0.90
      const result = await service.checkDuplicate(
        [0.5, 0.5, 0.5],
        '2026-08-14T00:00:00.000Z',
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateScore).toBeCloseTo(1.0, 5);
    });

    it('should check against batch buffer in addition to DB candidates', async () => {
      mockNewsArticleModel.find.mockReturnValue(chainableFind([]));

      const validObjectId = '507f1f77bcf86cd799439011';
      const batchBuffer = [
        { embedding: [0.5, 0.5, 0.5], id: validObjectId, title: 'Batch Article' },
      ];

      const result = await service.checkDuplicate(
        [0.5, 0.5, 0.5],
        '2026-08-14T00:00:00.000Z',
        0.90,
        batchBuffer,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateOf?.toString()).toBe(validObjectId);
    });
  });

  describe('saveArticles (with dedup)', () => {
    it('should save new article with embedding when not duplicate', async () => {
      mockNewsArticleModel.findOne.mockResolvedValue(null); // urlHash not found
      mockNewsArticleModel.find.mockReturnValue(chainableFind([])); // no candidates
      mockEmbeddingService.createEmbedding.mockResolvedValue(
        new Array(512).fill(0.1),
      );

      // Mock save
      const mockSave = jest.fn().mockResolvedValue(true);
      mockNewsArticleModel.findOne.mockResolvedValue(null);

      // We need to mock the constructor pattern
      const originalNewsArticleModel = mockNewsArticleModel;
      mockNewsArticleModel = {
        ...originalNewsArticleModel,
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockReturnValue(chainableFind([])),
      };

      // Re-inject mock
      (service as any).newsArticleModel = mockNewsArticleModel;

      const articles = [
        {
          title: 'Test Article',
          url: 'https://example.com/test',
          source: 'Test',
          content: 'Some content',
        },
      ];

      // The constructor pattern `new this.newsArticleModel(...)` needs special mocking
      // We mock the model itself to return a mock instance
      const mockInstance = {
        save: jest.fn().mockResolvedValue(true),
        _id: 'newArticleId',
      };
      (service as any).newsArticleModel = Object.assign(
        jest.fn().mockReturnValue(mockInstance),
        {
          findOne: jest.fn().mockResolvedValue(null),
          find: jest.fn().mockReturnValue(chainableFind([])),
        },
      );

      const result = await service.saveArticles(articles);

      expect(result.savedCount).toBe(1);
      expect(result.duplicates).toBe(0);
      expect(mockInstance.save).toHaveBeenCalled();
      expect(mockEmbeddingService.createEmbedding).toHaveBeenCalled();
    });

    it('should skip duplicate (embedding score >= threshold) and update RawArticle', async () => {
      const rawArticleId = 'rawId123';
      const existingArticleId = 'existingId456';
      const sharedEmbedding = new Array(512).fill(0.5);

      // urlHash not found in NewsArticle
      const mockFindOne = jest.fn().mockResolvedValue(null);

      // Candidates with identical embedding
      const mockFind = jest.fn().mockReturnValue(
        chainableFind([
          {
            _id: existingArticleId,
            contentEmbedding: sharedEmbedding,
            title: 'Original Article',
          },
        ]),
      );

      (service as any).newsArticleModel = Object.assign(
        jest.fn(),
        { findOne: mockFindOne, find: mockFind },
      );

      (service as any).rawArticleModel = {
        updateOne: jest.fn().mockResolvedValue({}),
      };

      mockEmbeddingService.createEmbedding.mockResolvedValue(sharedEmbedding);

      const articles = [
        {
          _id: rawArticleId,
          title: 'Duplicate Article',
          url: 'https://example.com/dup',
          source: 'Test',
          content: 'Same content',
        },
      ];

      const result = await service.saveArticles(articles);

      expect(result.savedCount).toBe(0);
      expect(result.duplicates).toBe(1);
      expect((service as any).rawArticleModel.updateOne).toHaveBeenCalledWith(
        { _id: rawArticleId },
        {
          $set: expect.objectContaining({
            isDuplicate: true,
            duplicateOfArticleId: expect.anything(),
            duplicateScore: expect.any(Number),
          }),
        },
      );
    });

    it('should handle embedding failure gracefully (save without dedup)', async () => {
      mockEmbeddingService.createEmbedding.mockRejectedValue(
        new Error('API rate limited'),
      );

      const mockInstance = {
        save: jest.fn().mockResolvedValue(true),
        _id: 'newArticleId',
      };

      (service as any).newsArticleModel = Object.assign(
        jest.fn().mockReturnValue(mockInstance),
        {
          findOne: jest.fn().mockResolvedValue(null),
          find: jest.fn().mockReturnValue(chainableFind([])),
        },
      );

      (service as any).rawArticleModel = {
        updateOne: jest.fn().mockResolvedValue({}),
      };

      const articles = [
        {
          _id: 'rawId123',
          title: 'Article with embedding failure',
          url: 'https://example.com/test',
          source: 'Test',
          content: 'Some content',
        },
      ];

      const result = await service.saveArticles(articles);

      // Should still save (no dedup check = no duplicate)
      expect(result.savedCount).toBe(1);
      expect(result.duplicates).toBe(0);
      expect(mockInstance.save).toHaveBeenCalled();
    });
  });

  describe('backfillEmbeddings', () => {
    it('should process articles without embeddings', async () => {
      const articles = [
        { _id: '1', title: 'Article 1', summary: 'S1', content: 'C1' },
        { _id: '2', title: 'Article 2', summary: 'S2', content: 'C2' },
      ];

      mockNewsArticleModel.find.mockReturnValue(chainableFind(articles));
      mockEmbeddingService.prepareEmbeddingInput
        .mockReturnValueOnce('input1')
        .mockReturnValueOnce('input2');
      mockEmbeddingService.createEmbedding
        .mockResolvedValueOnce(new Array(512).fill(0.1))
        .mockResolvedValueOnce(new Array(512).fill(0.2));

      const mockUpdateOne = jest.fn().mockResolvedValue({});
      mockNewsArticleModel.updateOne = mockUpdateOne;

      const result = await service.backfillEmbeddings(50);

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockUpdateOne).toHaveBeenCalledTimes(2);
    });

    it('should count failures and continue processing', async () => {
      const articles = [
        { _id: '1', title: 'Article 1' },
        { _id: '2', title: 'Article 2' },
      ];

      mockNewsArticleModel.find.mockReturnValue(chainableFind(articles));
      mockEmbeddingService.prepareEmbeddingInput
        .mockReturnValueOnce('input1')
        .mockReturnValueOnce('input2');
      mockEmbeddingService.createEmbedding
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(new Array(512).fill(0.1));

      mockNewsArticleModel.updateOne = jest.fn().mockResolvedValue({});

      const result = await service.backfillEmbeddings(50);

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  // ── M2: Batch dedup integration test ──

  describe('saveArticles — batch dedup (M2)', () => {
    it('should detect second article as duplicate via batchEmbeddings buffer when both have identical embeddings in one call', async () => {
      const sharedEmbedding = new Array(512).fill(0.5);

      // Both articles: urlHash not in DB
      const mockFindOne = jest.fn().mockResolvedValue(null);
      // No DB candidates
      const mockFind = jest.fn().mockReturnValue(chainableFind([]));

      const validObjectId1 = '507f1f77bcf86cd799439011';
      const validObjectId2 = '507f1f77bcf86cd799439022';

      const mockInstance1 = {
        save: jest.fn().mockResolvedValue(true),
        _id: validObjectId1,
      };
      const mockInstance2 = {
        save: jest.fn().mockResolvedValue(true),
        _id: validObjectId2,
      };

      let callCount = 0;
      (service as any).newsArticleModel = Object.assign(
        jest.fn(() => {
          callCount++;
          return callCount === 1 ? mockInstance1 : mockInstance2;
        }),
        { findOne: mockFindOne, find: mockFind },
      );

      (service as any).rawArticleModel = {
        updateOne: jest.fn().mockResolvedValue({}),
      };

      mockEmbeddingService.createEmbedding.mockResolvedValue(sharedEmbedding);

      const articles = [
        {
          title: 'Article Alpha',
          url: 'https://example.com/alpha',
          source: 'Test',
          content: 'Content A',
        },
        {
          title: 'Article Beta (duplicate)',
          url: 'https://example.com/beta',
          source: 'Test',
          content: 'Content B',
        },
      ];

      const result = await service.saveArticles(articles);

      // First article saved, second detected as duplicate via batch buffer
      expect(result.savedCount).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(mockInstance1.save).toHaveBeenCalled();
      expect(mockInstance2.save).not.toHaveBeenCalled();
    });
  });

  // ── M3: retroactiveDedupScan tests ──

  describe('retroactiveDedupScan (M3)', () => {
    it('should run without error when no articles have embeddings', async () => {
      mockNewsArticleModel.find.mockReturnValue(chainableFind([]));
      mockNewsArticleModel.updateOne = jest.fn().mockResolvedValue({});

      const result = await service.retroactiveDedupScan();

      expect(result.duplicatesFound).toBe(0);
    });

    it('should mark newer article as duplicate when cosine similarity >= threshold', async () => {
      const olderId = '507f1f77bcf86cd799439011';
      const newerId = '507f1f77bcf86cd799439022';
      const sharedEmbedding = [0.5, 0.5, 0.5, 0.5];

      const articles = [
        {
          _id: olderId,
          contentEmbedding: sharedEmbedding,
          title: 'Original Article',
          publishDate: '2026-08-01T00:00:00.000Z',
        },
        {
          _id: newerId,
          contentEmbedding: sharedEmbedding,
          title: 'Duplicate Article',
          publishDate: '2026-08-10T00:00:00.000Z',
        },
      ];

      mockNewsArticleModel.find.mockReturnValue(chainableFind(articles));
      const mockUpdateOne = jest.fn().mockResolvedValue({});
      mockNewsArticleModel.updateOne = mockUpdateOne;

      const result = await service.retroactiveDedupScan();

      expect(result.duplicatesFound).toBe(1);
      // Should mark the newer article with dedup fields
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: newerId },
        {
          $set: {
            isDuplicate: true,
            duplicateOf: olderId,
            duplicateScore: 1.0,
          },
        },
      );
    });

    it('should not mark articles when similarity is below threshold', async () => {
      const articles = [
        {
          _id: '507f1f77bcf86cd799439011',
          contentEmbedding: [1.0, 0.0, 0.0],
          title: 'Article A',
          publishDate: '2026-08-01T00:00:00.000Z',
        },
        {
          _id: '507f1f77bcf86cd799439022',
          contentEmbedding: [0.0, 0.0, 1.0],
          title: 'Article B',
          publishDate: '2026-08-10T00:00:00.000Z',
        },
      ];

      mockNewsArticleModel.find.mockReturnValue(chainableFind(articles));
      const mockUpdateOne = jest.fn().mockResolvedValue({});
      mockNewsArticleModel.updateOne = mockUpdateOne;

      const result = await service.retroactiveDedupScan();

      expect(result.duplicatesFound).toBe(0);
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('should skip articles outside the dedup window', async () => {
      const articles = [
        {
          _id: '507f1f77bcf86cd799439011',
          contentEmbedding: [0.5, 0.5, 0.5],
          title: 'Old Article',
          publishDate: '2026-06-01T00:00:00.000Z',
        },
        {
          _id: '507f1f77bcf86cd799439022',
          contentEmbedding: [0.5, 0.5, 0.5],
          title: 'New Article (>30 days later)',
          publishDate: '2026-08-10T00:00:00.000Z',
        },
      ];

      mockNewsArticleModel.find.mockReturnValue(chainableFind(articles));
      const mockUpdateOne = jest.fn().mockResolvedValue({});
      mockNewsArticleModel.updateOne = mockUpdateOne;

      const result = await service.retroactiveDedupScan();

      // 70+ days apart > 30 day window → should not mark
      expect(result.duplicatesFound).toBe(0);
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });
  });
});
