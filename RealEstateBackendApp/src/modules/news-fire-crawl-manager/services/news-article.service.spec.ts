jest.mock('jsdom', () => ({}));
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NewsArticleService } from './news-article.service';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import { WordPressService } from './wordpress.service';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';

describe('NewsArticleService', () => {
  let service: NewsArticleService;
  let mockNewsArticleModel: any;

  beforeEach(async () => {
    mockNewsArticleModel = {
      updateMany: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
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
          useValue: {},
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
});
