import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { ExternalLogService } from './external-log.service';
import { ExternalLogSanitizerService } from './external-log-sanitizer.service';
import {
  ExternalRequestLog,
  ExternalRequestType,
} from '../schemas/external-request-log.schema';

/** Tạo chainable query mock: find(query).sort().skip().limit().exec() → data */
function chainableFind(data: any) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnThis();
  chain.skip = jest.fn().mockReturnThis();
  chain.limit = jest.fn().mockReturnThis();
  chain.exec = jest.fn().mockResolvedValue(data);
  return chain;
}

/**
 * Unit test cho ExternalLogService — logger tập trung outgoing request (crawl + AI).
 * Mock Mongoose Model (create) + ConfigService; dùng instance thật của
 * ExternalLogSanitizerService (stateless).
 */
describe('ExternalLogService', () => {
  let service: ExternalLogService;
  let mockModel: any;
  let mockConfigService: { get: jest.Mock };

  const buildModule = async (configGet: (key: string) => any) => {
    mockConfigService = { get: jest.fn(configGet) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExternalLogService,
        {
          provide: getModelToken(ExternalRequestLog.name),
          useValue: mockModel,
        },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: ExternalLogSanitizerService,
          useValue: new ExternalLogSanitizerService(),
        },
      ],
    }).compile();

    return module.get<ExternalLogService>(ExternalLogService);
  };

  beforeEach(async () => {
    mockModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findById: jest.fn(),
    };
    // Config default: ENABLE_EXTERNAL_LOGGING=true, MAX_LOG_BODY_BYTES=51200.
    service = await buildModule(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logCrawl', () => {
    it('gọi model.create với doc CRAWL_OUTGOING đã sanitize', () => {
      mockModel.create.mockResolvedValue({});

      service.logCrawl({
        targetService: 'VnExpress',
        url: 'https://vnexpress.net/rss?api_key=secret',
        method: 'get',
        statusCode: 200,
        durationMs: 123,
        requestHeaders: { Authorization: 'Bearer abc' },
        responseBody: { data: 'ok' },
      });

      expect(mockModel.create).toHaveBeenCalledTimes(1);
      const doc = mockModel.create.mock.calls[0][0];
      expect(doc.type).toBe(ExternalRequestType.CRAWL_OUTGOING);
      expect(doc.targetService).toBe('VnExpress');
      expect(doc.method).toBe('get');
      expect(doc.url).toContain('api_key=***REDACTED***');
      expect(doc.request.headers).toEqual({
        Authorization: '***REDACTED***',
      });
      expect(doc.response.body).toEqual({ data: 'ok' });
      expect(doc.sourceModule).toBe('CustomCrawlerService');
    });

    it('sourceModule tùy chỉnh được giữ nguyên', () => {
      mockModel.create.mockResolvedValue({});

      service.logCrawl({
        targetService: 'S',
        url: 'https://s.example',
        method: 'GET',
        durationMs: 1,
        sourceModule: 'FirecrawlService',
      });

      expect(mockModel.create.mock.calls[0][0].sourceModule).toBe(
        'FirecrawlService',
      );
    });
  });

  describe('logAi', () => {
    it('gọi model.create với doc AI_OUTGOING + metadata.model', () => {
      mockModel.create.mockResolvedValue({});

      service.logAi({
        provider: 'OpenRouter',
        model: 'google/gemini-2.5-flash',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        durationMs: 500,
        prompt: 'SYSTEM: phân tích thị trường',
        requestHeaders: { 'x-api-key': 'sk-xxx' },
      });

      expect(mockModel.create).toHaveBeenCalledTimes(1);
      const doc = mockModel.create.mock.calls[0][0];
      expect(doc.type).toBe(ExternalRequestType.AI_OUTGOING);
      expect(doc.targetService).toBe('OpenRouter');
      expect(doc.request.headers['x-api-key']).toBe('***REDACTED***');
      expect(doc.metadata).toEqual({ model: 'google/gemini-2.5-flash' });
      expect(doc.sourceModule).toBe('AIFilterService');
    });
  });

  describe('fire-and-forget (§12)', () => {
    it('create reject → logCrawl/logAi KHÔNG throw ra ngoài', () => {
      mockModel.create.mockRejectedValue(new Error('DB down'));

      expect(() =>
        service.logCrawl({
          targetService: 'S',
          url: 'https://s.example',
          method: 'GET',
          durationMs: 1,
        }),
      ).not.toThrow();

      expect(() =>
        service.logAi({
          provider: 'OpenRouter',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          durationMs: 1,
          prompt: 'p',
        }),
      ).not.toThrow();
    });
  });

  describe('ENABLE_EXTERNAL_LOGGING', () => {
    it('=false → early return, KHÔNG gọi model.create', async () => {
      service = await buildModule((key) =>
        key === 'ENABLE_EXTERNAL_LOGGING' ? 'false' : undefined,
      );

      service.logCrawl({
        targetService: 'S',
        url: 'https://s.example',
        method: 'GET',
        durationMs: 1,
      });
      service.logAi({
        provider: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        durationMs: 1,
        prompt: 'p',
      });

      expect(mockModel.create).not.toHaveBeenCalled();
    });
  });

  describe('mapUsage (snake_case → camelCase)', () => {
    it('map prompt_tokens/completion_tokens/total_tokens sang camelCase', () => {
      mockModel.create.mockResolvedValue({});

      service.logAi({
        provider: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        durationMs: 10,
        prompt: 'p',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      expect(mockModel.create.mock.calls[0][0].response.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });

    it('giữ nguyên usage đã là camelCase', () => {
      mockModel.create.mockResolvedValue({});

      service.logAi({
        provider: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        durationMs: 10,
        prompt: 'p',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      });

      expect(mockModel.create.mock.calls[0][0].response.usage).toEqual({
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      });
    });
  });

  describe('truncate body quá MAX_LOG_BODY_BYTES', () => {
    it('responseBody string quá giới hạn → cắt + ...[TRUNCATED]', async () => {
      service = await buildModule((key) =>
        key === 'MAX_LOG_BODY_BYTES' ? '10' : undefined,
      );
      mockModel.create.mockResolvedValue({});

      service.logCrawl({
        targetService: 'S',
        url: 'https://s.example',
        method: 'GET',
        durationMs: 1,
        responseBody: 'x'.repeat(100),
      });

      expect(mockModel.create.mock.calls[0][0].response.body).toBe(
        'xxxxxxxxxx...[TRUNCATED]',
      );
    });

    it('request.prompt quá giới hạn → cắt + ...[TRUNCATED]', async () => {
      service = await buildModule((key) =>
        key === 'MAX_LOG_BODY_BYTES' ? '10' : undefined,
      );
      mockModel.create.mockResolvedValue({});

      service.logAi({
        provider: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        durationMs: 1,
        prompt: 'p'.repeat(100),
      });

      expect(mockModel.create.mock.calls[0][0].request.prompt).toBe(
        'pppppppppp...[TRUNCATED]',
      );
    });
  });

  describe('findAll — filter theo startDate/endDate (bug timezone)', () => {
    it('date-only YYYY-MM-DD → quy đổi qua startOfDayUtc/endOfDayUtc (giờ Việt Nam)', async () => {
      mockModel.find.mockReturnValue(chainableFind([]));
      mockModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findAll({
        startDate: '2026-08-05',
        endDate: '2026-08-05',
      } as any);

      const query = mockModel.find.mock.calls[0][0];
      // Literal ISO hardcode (KHÔNG gọi lại startOfDayUtc/endOfDayUtc) để tránh
      // assertion tự tham chiếu — nếu helper bị sửa sai, test này vẫn phải fail.
      // 00:00:00 ngày 05/08 giờ VN = 17:00:00 ngày 04/08 UTC (offset +7).
      // 23:59:59.999 ngày 05/08 giờ VN = 16:59:59.999 ngày 05/08 UTC (offset +7).
      expect(query.createdAt.$gte).toEqual(new Date('2026-08-04T17:00:00.000Z'));
      expect(query.createdAt.$lte).toEqual(new Date('2026-08-05T16:59:59.999Z'));

      // Case biên: log tạo lúc 06:54:02 sáng giờ VN ngày 05/08
      // (= 2026-08-04T23:54:02.000Z UTC) phải nằm TRONG khoảng lọc ngày 05/08 —
      // trước fix, endDate không set về cuối ngày nên mất sạch log từ 07:00 VN trở đi,
      // còn startDate parse UTC midnight nên lệch 7h.
      const boundaryLogCreatedAt = new Date('2026-08-04T23:54:02.000Z');
      expect(boundaryLogCreatedAt.getTime()).toBeGreaterThanOrEqual(
        query.createdAt.$gte.getTime(),
      );
      expect(boundaryLogCreatedAt.getTime()).toBeLessThanOrEqual(
        query.createdAt.$lte.getTime(),
      );
    });

    it('full ISO timestamp → giữ nguyên new Date(), KHÔNG quy đổi qua timezone helper', async () => {
      mockModel.find.mockReturnValue(chainableFind([]));
      mockModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findAll({
        startDate: '2026-08-05T10:30:00.000Z',
        endDate: '2026-08-05T20:15:00.000Z',
      } as any);

      const query = mockModel.find.mock.calls[0][0];
      expect(query.createdAt.$gte).toEqual(new Date('2026-08-05T10:30:00.000Z'));
      expect(query.createdAt.$lte).toEqual(new Date('2026-08-05T20:15:00.000Z'));
    });

    it('chỉ truyền startDate date-only → $lte không được set', async () => {
      mockModel.find.mockReturnValue(chainableFind([]));
      mockModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findAll({ startDate: '2026-08-05' } as any);

      const query = mockModel.find.mock.calls[0][0];
      // Literal ISO hardcode, không gọi lại helper — xem giải thích ở test phía trên.
      expect(query.createdAt.$gte).toEqual(new Date('2026-08-04T17:00:00.000Z'));
      expect(query.createdAt.$lte).toBeUndefined();
    });
  });
});
