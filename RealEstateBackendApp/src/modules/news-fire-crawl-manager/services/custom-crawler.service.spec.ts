/**
 * CustomCrawlerService unit spec — contract mục 2 (crawl RSS + AI extractor),
 * mục 1 (Least Privilege / upsert theo urlHash), mục 2 Response Format phân trang.
 *
 * Mock boundary:
 * - axios.get (HTTP ra ngoài — RSS feed + trang listing).
 * - rss-parser module (new Parser() → parseString jest.fn).
 * - fs (tránh ghi đĩa thật trong crawlData).
 * - generateUrlHash giữ thật (crypto SHA-256) để verify contract urlHash.
 * - Mongoose Model chainable find().sort().skip().limit().exec() + countDocuments.
 *
 * KHÔNG test chi tiết implementation nội bộ của cheerio/AI parser, chỉ test
 * hành vi observable: upsert gọi đúng query, stats trả đúng, filter ngày đúng.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import axios from 'axios';
import { CustomCrawlerService } from './custom-crawler.service';
import { NewsSourceService } from './news-source.service';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { RawArticle } from '../schemas/raw-article.schema';

// Mock rss-parser: constructor trả object có parseString jest.fn.
jest.mock('rss-parser', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      parseString: jest.fn(),
    })),
  };
});

// Mock fs để crawlData không ghi ra đĩa thật.
jest.mock('fs', () => ({
  __esModule: true,
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock axios.get — override per-test bằng axios.get.mockResolvedValue.
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Tạo chainable query mock: find(query).sort().skip().limit().exec() → data
 *  Trả về thêm spy `sortSpy` để caller assert tham số sort. */
function chainableFind(data: any) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnThis();
  chain.skip = jest.fn().mockReturnThis();
  chain.limit = jest.fn().mockReturnThis();
  chain.lean = jest.fn().mockReturnThis();
  chain.exec = jest.fn().mockResolvedValue(data);
  return chain;
}

describe('CustomCrawlerService', () => {
  let service: CustomCrawlerService;
  let mockRawArticleModel: any;
  let newsSourceService: any;
  let aiFilterService: any;
  let aiPromptConfigService: any;

  beforeEach(async () => {
    mockRawArticleModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findByIdAndDelete: jest.fn().mockReturnValue({ exec: jest.fn() }),
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };

    newsSourceService = { findActive: jest.fn() };
    aiFilterService = { callAiCompletion: jest.fn() };
    aiPromptConfigService = { getPromptByName: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomCrawlerService,
        { provide: NewsSourceService, useValue: newsSourceService },
        { provide: AIFilterService, useValue: aiFilterService },
        { provide: AiPromptConfigService, useValue: aiPromptConfigService },
        {
          provide: getModelToken(RawArticle.name),
          useValue: mockRawArticleModel,
        },
      ],
    }).compile();

    service = module.get<CustomCrawlerService>(CustomCrawlerService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('crawlData — RSS source', () => {
    it('parse RSS thành công → upsert đúng số bài, stats successfulSources=1', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'VnExpress', url: 'https://vnexpress.net', rssUrl: 'https://vnexpress.net/rss' },
      ]);
      mockedAxios.get.mockResolvedValue({
        data: '<?xml version="1.0"?><rss><channel><item><title>Tin 1</title></item></channel></rss>',
      });
      const rssInstance = (service as any).rssParser;
      rssInstance.parseString.mockResolvedValue({
        items: [
          { title: 'Tin 1', link: 'https://vnexpress.net/tin-1', contentSnippet: 'desc 1', pubDate: 'Wed, 28 Jul 2026 10:00:00 +0000' },
          { title: 'Tin 2', link: 'https://vnexpress.net/tin-2', contentSnippet: 'desc 2', pubDate: 'Wed, 28 Jul 2026 11:00:00 +0000' },
        ],
      });

      const result = await service.crawlData();

      expect(result.stats.successfulSources).toBe(1);
      expect(result.stats.failedSources).toBe(0);
      expect(result.stats.totalArticles).toBe(2);
      expect(mockRawArticleModel.updateOne).toHaveBeenCalledTimes(2);
      const call = mockRawArticleModel.updateOne.mock.calls[0];
      expect(call[0]).toEqual({ urlHash: expect.any(String) });
      expect(call[1]).toMatchObject({ $set: expect.objectContaining({ urlHash: expect.any(String) }) });
      expect(call[2]).toEqual({ upsert: true });
    });

    it('filter theo days: bỏ qua bài cũ hơn cutoff', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'S', url: 'https://s.example', rssUrl: 'https://s.example/rss' },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<rss></rss>' });
      const old = new Date();
      old.setDate(old.getDate() - 30);
      const recent = new Date();
      const rssInstance = (service as any).rssParser;
      rssInstance.parseString.mockResolvedValue({
        items: [
          { title: 'Cũ', link: 'https://s.example/cu', pubDate: old.toISOString() },
          { title: 'Mới', link: 'https://s.example/moi', pubDate: recent.toISOString() },
        ],
      });

      const result = await service.crawlData(7);
      expect(result.stats.totalArticles).toBe(1);
      expect(mockRawArticleModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('filter theo startDate/endDate: chỉ giữ bài trong khoảng', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'S', url: 'https://s.example', rssUrl: 'https://s.example/rss' },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<rss></rss>' });
      const rssInstance = (service as any).rssParser;
      rssInstance.parseString.mockResolvedValue({
        items: [
          { title: 'Trước', link: 'https://s.example/before', pubDate: '2026-07-01T10:00:00Z' },
          { title: 'Trong', link: 'https://s.example/in', pubDate: '2026-07-25T10:00:00Z' },
          { title: 'Sau', link: 'https://s.example/after', pubDate: '2026-07-30T10:00:00Z' },
        ],
      });

      const result = await service.crawlData(undefined, '2026-07-20', '2026-07-28');
      expect(result.stats.totalArticles).toBe(1);
    });

    it('bài thiếu title → bị skip ở filter (line 220), KHÔNG lên DB', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'S', url: 'https://s.example', rssUrl: 'https://s.example/rss' },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<rss></rss>' });
      const rssInstance = (service as any).rssParser;
      rssInstance.parseString.mockResolvedValue({
        items: [
          { title: '', link: 'https://s.example/no-title', pubDate: new Date().toISOString() },
          { title: 'Hợp lệ', link: 'https://s.example/ok', pubDate: new Date().toISOString() },
        ],
      });

      const result = await service.crawlData();
      // Chỉ bài có title được upsert; bài thiếu title bị skip ở filter.
      expect(result.stats.totalArticles).toBe(1);
      expect(mockRawArticleModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('source lỗi (axios throw) → failedSources++, KHÔNG throw ra ngoài', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'Bad', url: 'https://bad.example', rssUrl: 'https://bad.example/rss' },
      ]);
      mockedAxios.get.mockRejectedValue(new Error('network down'));

      const result = await service.crawlData();
      expect(result.stats.failedSources).toBe(1);
      expect(result.stats.successfulSources).toBe(0);
      expect(result.stats.failedDetails).toEqual([{ url: 'https://bad.example' }]);
    });

    it('RSS parse throw → source tính là failed', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'S', url: 'https://s.example', rssUrl: 'https://s.example/rss' },
      ]);
      mockedAxios.get.mockResolvedValue({ data: 'not xml' });
      const rssInstance = (service as any).rssParser;
      rssInstance.parseString.mockRejectedValue(new Error('parse error'));

      const result = await service.crawlData();
      expect(result.stats.failedSources).toBe(1);
    });

    it('không có active source → stats rỗng, không gọi axios', async () => {
      newsSourceService.findActive.mockResolvedValue([]);
      const result = await service.crawlData();
      expect(result.stats).toEqual({
        successfulSources: 0,
        failedSources: 0,
        totalArticles: 0,
        successfulDetails: [],
        failedDetails: [],
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('crawlData — AI extractor source (không rssUrl)', () => {
    it('dùng cheerio load HTML + AI trả JSON array → upsert đúng bài, URL relative được resolve', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'AI-src', url: 'https://ai.example', rssUrl: undefined },
      ]);
      mockedAxios.get.mockResolvedValue({
        data: '<html><body><a href="/post-1">Post 1</a></body></html>',
      });
      aiPromptConfigService.getPromptByName.mockReturnValue('extract prompt');
      aiFilterService.callAiCompletion.mockResolvedValue(
        JSON.stringify([
          { title: 'Post 1', url: '/post-1', publishedAt: new Date().toISOString() },
        ]),
      );

      const result = await service.crawlData();
      expect(result.stats.successfulSources).toBe(1);
      expect(result.stats.totalArticles).toBe(1);
      expect(mockRawArticleModel.updateOne.mock.calls[0][1].$set.url).toBe('https://ai.example/post-1');
    });

    it('AI trả JSON có key articles → trích đúng mảng', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'AI-src', url: 'https://ai.example', rssUrl: undefined },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<html><body>x</body></html>' });
      aiPromptConfigService.getPromptByName.mockReturnValue('p');
      aiFilterService.callAiCompletion.mockResolvedValue(
        JSON.stringify({ articles: [{ title: 'A', url: 'https://ai.example/a', publishedAt: new Date().toISOString() }] }),
      );

      const result = await service.crawlData();
      expect(result.stats.totalArticles).toBe(1);
    });

    it('thiếu EXTRACT_LISTING_PROMPT (getPromptByName trả rỗng) → source failed', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'AI-src', url: 'https://ai.example', rssUrl: undefined },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<html><body>x</body></html>' });
      aiPromptConfigService.getPromptByName.mockReturnValue('');

      const result = await service.crawlData();
      expect(result.stats.failedSources).toBe(1);
    });

    it('AI output không parse được JSON → 0 bài, source vẫn success', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'AI-src', url: 'https://ai.example', rssUrl: undefined },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<html><body>x</body></html>' });
      aiPromptConfigService.getPromptByName.mockReturnValue('p');
      aiFilterService.callAiCompletion.mockResolvedValue('not-json');

      const result = await service.crawlData();
      expect(result.stats.totalArticles).toBe(0);
      expect(result.stats.successfulSources).toBe(1);
    });

    it('AI output bọc trong ```json ... ``` fence → vẫn parse được', async () => {
      newsSourceService.findActive.mockResolvedValue([
        { name: 'AI-src', url: 'https://ai.example', rssUrl: undefined },
      ]);
      mockedAxios.get.mockResolvedValue({ data: '<html><body>x</body></html>' });
      aiPromptConfigService.getPromptByName.mockReturnValue('p');
      const inner = JSON.stringify([{ title: 'Fenced', url: 'https://ai.example/f', publishedAt: new Date().toISOString() }]);
      aiFilterService.callAiCompletion.mockResolvedValue('```json\n' + inner + '\n```');

      const result = await service.crawlData();
      expect(result.stats.totalArticles).toBe(1);
    });
  });

  describe('getRawArticles (phân trang + filter)', () => {
    it('trả { data, total } và gọi find/countDocuments cùng query', async () => {
      const data = [{ _id: 'a' }, { _id: 'b' }];
      mockRawArticleModel.find.mockReturnValue(chainableFind(data));
      mockRawArticleModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });

      const result = await service.getRawArticles(undefined, 'newest', undefined, undefined, 1, 20);

      expect(result).toEqual({ data, total: 2 });
      expect(mockRawArticleModel.find).toHaveBeenCalledWith({});
      expect(mockRawArticleModel.countDocuments).toHaveBeenCalledWith({});
    });

    it('search → query $or trên title + description, escape regex ký tự đặc biệt (chống NoSQL injection)', async () => {
      mockRawArticleModel.find.mockReturnValue(chainableFind([]));
      mockRawArticleModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getRawArticles('a.b*c', 'newest');

      const query = mockRawArticleModel.find.mock.calls[0][0];
      expect(query.$or).toHaveLength(2);
      expect(query.$or[0].title.$regex).toBe('a\\.b\\*c');
      expect(query.$or[0].title.$options).toBe('i');
      expect(query.$or[1].description.$regex).toBe('a\\.b\\*c');
    });

    it('sort newest → find().sort({ publishedAt: -1 })', async () => {
      const chain = chainableFind([]);
      mockRawArticleModel.find.mockReturnValue(chain);
      mockRawArticleModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getRawArticles(undefined, 'newest');

      expect(chain.sort).toHaveBeenCalledWith({ publishedAt: -1 });
    });

    it('sort oldest → find().sort({ publishedAt: 1 })', async () => {
      const chain = chainableFind([]);
      mockRawArticleModel.find.mockReturnValue(chain);
      mockRawArticleModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getRawArticles(undefined, 'oldest');

      expect(chain.sort).toHaveBeenCalledWith({ publishedAt: 1 });
    });

    it('startDate/endDate → query.publishedAt có $gte/$lte dạng ISO', async () => {
      mockRawArticleModel.find.mockReturnValue(chainableFind([]));
      mockRawArticleModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.getRawArticles(undefined, 'newest', '2026-07-01', '2026-07-31');

      const query = mockRawArticleModel.find.mock.calls[0][0];
      expect(query.publishedAt).toBeDefined();
      expect(query.publishedAt.$gte).toMatch(/^2026-07-01T00:00:00/);
      expect(query.publishedAt.$lte).toMatch(/^2026-07-31T23:59:59/);
    });
  });

  describe('getRawArticlesByIds', () => {
    it('find với _id $in ids + lean', async () => {
      const exec = jest.fn().mockResolvedValue([{ _id: '1' }]);
      mockRawArticleModel.find.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec }) });

      const result = await service.getRawArticlesByIds(['1', '2']);
      expect(result).toEqual([{ _id: '1' }]);
      expect(mockRawArticleModel.find).toHaveBeenCalledWith({ _id: { $in: ['1', '2'] } });
    });
  });

  describe('deleteRawArticle', () => {
    it('gọi findByIdAndDelete(id).exec()', async () => {
      const exec = jest.fn();
      mockRawArticleModel.findByIdAndDelete.mockReturnValue({ exec });
      await service.deleteRawArticle('abc');
      expect(mockRawArticleModel.findByIdAndDelete).toHaveBeenCalledWith('abc');
    });
  });

  describe('deleteRawArticlesBulk', () => {
    it('gọi deleteMany({ _id: { $in: ids } }).exec()', async () => {
      const exec = jest.fn();
      mockRawArticleModel.deleteMany.mockReturnValue({ exec });
      await service.deleteRawArticlesBulk(['1', '2']);
      expect(mockRawArticleModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['1', '2'] } });
    });
  });

  describe('deleteRawArticlesNotIn (DEPRECATED)', () => {
    it('gọi deleteMany({ urlHash: { $nin: urlHashes } })', async () => {
      const exec = jest.fn();
      mockRawArticleModel.deleteMany.mockReturnValue({ exec });
      await service.deleteRawArticlesNotIn(['h1', 'h2']);
      expect(mockRawArticleModel.deleteMany).toHaveBeenCalledWith({ urlHash: { $nin: ['h1', 'h2'] } });
    });
  });

  describe('deleteRawArticlesInSetNotIn', () => {
    it('submittedHashes rỗng → KHÔNG gọi deleteMany (tránh xóa nhầm)', async () => {
      const exec = jest.fn();
      mockRawArticleModel.deleteMany.mockReturnValue({ exec });
      await service.deleteRawArticlesInSetNotIn([], ['keep']);
      expect(mockRawArticleModel.deleteMany).not.toHaveBeenCalled();
    });

    it('submittedHashes có giá trị → deleteMany với $in ∩ $nin', async () => {
      const exec = jest.fn();
      mockRawArticleModel.deleteMany.mockReturnValue({ exec });
      await service.deleteRawArticlesInSetNotIn(['s1', 's2'], ['s1']);
      expect(mockRawArticleModel.deleteMany).toHaveBeenCalledWith({
        urlHash: { $in: ['s1', 's2'], $nin: ['s1'] },
      });
    });
  });
});
