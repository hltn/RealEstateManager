jest.mock('jsdom', () => ({}));
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { NewsArticleService } from './news-article.service';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import { WordPressService } from './wordpress.service';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { ArticleExtractorUtil } from '../../../utils/article-extractor.util';

describe('NewsArticleService', () => {
  let service: NewsArticleService;
  let mockNewsArticleModel: any;
  let mockAiFilterService: any;

  beforeEach(async () => {
    mockNewsArticleModel = {
      updateMany: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
    };

    mockAiFilterService = {
      cleanMarkdownContentWithAI: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsArticleService,
        {
          provide: getModelToken(NewsArticle.name),
          useValue: mockNewsArticleModel,
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
      jest.spyOn(service, 'cleanupUncontentCrawledStatus').mockResolvedValue({ modifiedCount: 5 });

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
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue('Cleaned content');

      await service.cleanArticle('123');

      expect(mockArticle.status).toEqual([NewsStatus.POSTED_WP, NewsStatus.CRAWLED]);
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
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue('Cleaned content');

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
      mockAiFilterService.cleanMarkdownContentWithAI.mockResolvedValue('Content');

      await service.cleanArticle('123');
      expect(mockArticleValid.publishDate).toBe(new Date('2026-06-15T10:00:00Z').toISOString());
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

      await service.cleanArticle('456');
      expect(mockArticleInvalid.publishDate).toBeDefined();
      expect(isNaN(new Date(mockArticleInvalid.publishDate).getTime())).toBe(false);
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
});
