jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));
// Mock GoogleGenAI để tránh khởi tạo SDK thật và gọi network
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: jest.fn() },
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { ConfigService } from '@nestjs/config';

/**
 * Unit test cho AIFilterService — service gọi AI (OpenRouter/Must1c/Gemini).
 * Mock fetch global + fs + GoogleGenAI để cô lập logic branching theo platform.
 */
describe('AIFilterService', () => {
  let service: AIFilterService;
  let mockConfigService: any;
  let mockAiPromptConfigService: any;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Cấu hình mặc định: có OpenRouter + Gemini
    mockConfigService = {
      get: jest.fn((key: string) => {
        const cfg: Record<string, string> = {
          GEMINI_API_KEY: 'gemini-key',
          OPENROUTER_API_KEY: 'or-key',
          OPENROUTER_AI_MODEL: 'google/gemini-2.5-flash',
          ACTIVE_AI_PLATFORM: 'OpenRouter',
        };
        return cfg[key];
      }),
    };

    mockAiPromptConfigService = {
      getPromptByName: jest.fn().mockReturnValue('SYSTEM_PROMPT'),
    };

    mockFs.readFileSync.mockReturnValue(
      JSON.stringify([{ url: 'https://x', title: 'T1', content: 'C1' }]),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFilterService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: AiPromptConfigService,
          useValue: mockAiPromptConfigService,
        },
      ],
    }).compile();

    service = module.get<AIFilterService>(AIFilterService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Helper tạo mock Response cho fetch
  const mockFetchResponse = (
    ok: boolean,
    body: any,
    status = 200,
  ): Response => {
    const res: Partial<Response> = {
      ok,
      status,
      json: jest.fn().mockResolvedValue(body),
      text: jest
        .fn()
        .mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    };
    return res as Response;
  };

  describe('filterAndRank', () => {
    it('should throw BadRequestException when no API key configured', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'OPENROUTER_API_KEY' ? undefined : key === 'GEMINI_API_KEY' ? 'your_gemini_api_key_here' : undefined,
      );

      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should call OpenRouter fetch and return parsed JSON', async () => {
      const top5 = [{ url: 'https://x', title: 'T1', score: 9 }];
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          mockFetchResponse(true, {
            choices: [{ message: { content: '```json\n' + JSON.stringify(top5) + '\n```' } }],
          }),
        );

      const result = await service.filterAndRank('file.json');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual(top5);
    });

    it('should throw when OpenRouter returns non-ok response', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockFetchResponse(false, 'err', 500));

      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should fallback to Gemini Native API when no OpenRouter key', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'OPENROUTER_API_KEY' ? undefined : 'gemini-key',
      );
      // Lấy instance mock của GoogleGenAI đã tạo trong constructor
      const genAiInstance = (service as any).ai;
      const top5 = [{ url: 'https://g', title: 'Gem', score: 8 }];
      genAiInstance.models.generateContent.mockResolvedValue({
        text: JSON.stringify(top5),
      });

      const result = await service.filterAndRank('file.json');

      expect(genAiInstance.models.generateContent).toHaveBeenCalled();
      expect(result).toEqual(top5);
    });

    it('should wrap readFileSync error in BadRequestException (sau khi fix, readFile trong try-catch)', async () => {
      // Sau fix: readFileSync + JSON.parse nằm TRONG try-catch → lỗi được bọc
      // trong BadRequestException với message nhất quán.
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('file missing');
      });

      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        /file missing/i,
      );
    });
  });

  describe('filterRawArticles', () => {
    it('should return empty array when input is empty', async () => {
      const result = await service.filterRawArticles([]);
      expect(result).toEqual([]);
    });

    it('should call Must1c when platform=Must1c and key present', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        const cfg: Record<string, string> = {
          ACTIVE_AI_PLATFORM: 'Must1c',
          MUST1C_API_KEY: 'm1c-key',
          MUST1C_MODEL: 'gemini-3.6-flash',
          MUST1C_API_URL: 'https://htmustc.id.vn/v1/chat/completions',
          OPENROUTER_API_KEY: undefined,
        };
        return cfg[key];
      });
      const parsed = [{ urlHash: 'h1', title: 'T1', reason: 'match' }];
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          mockFetchResponse(true, {
            choices: [{ message: { content: JSON.stringify(parsed) } }],
          }),
        );

      const result = await service.filterRawArticles([
        { _id: 'a', urlHash: 'h1', title: 'T1', description: 'D1' },
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://htmustc.id.vn/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual(parsed);
    });

    it('should map Must1c 401 to authentication_error message', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        const cfg: Record<string, string> = {
          ACTIVE_AI_PLATFORM: 'Must1c',
          MUST1C_API_KEY: 'm1c-key',
        };
        return cfg[key];
      });
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockFetchResponse(false, 'invalid key', 401));

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no AI platform configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when AI returns invalid JSON', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          mockFetchResponse(true, {
            choices: [{ message: { content: 'not-json-text' } }],
          }),
        );

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cleanMarkdownContentWithAI', () => {
    it('should return empty string when markdown is empty', async () => {
      expect(await service.cleanMarkdownContentWithAI('')).toBe('');
      expect(await service.cleanMarkdownContentWithAI('   ')).toBe('');
    });

    it('should return cleaned content via OpenRouter', async () => {
      const cleaned = 'Cleaned text';
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          mockFetchResponse(true, {
            choices: [{ message: { content: cleaned } }],
          }),
        );

      const result = await service.cleanMarkdownContentWithAI('raw md');
      expect(fetchSpy).toHaveBeenCalled();
      expect(result).toBe(cleaned);
    });

    it('should strip markdown code fences from response', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          mockFetchResponse(true, {
            choices: [{ message: { content: '```markdown\ncleaned\n```' } }],
          }),
        );

      const result = await service.cleanMarkdownContentWithAI('raw');
      expect(result).toBe('cleaned');
    });

    it('should fallback to Gemini when no OpenRouter/Must1c key', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'OPENROUTER_API_KEY'
          ? undefined
          : key === 'ACTIVE_AI_PLATFORM'
            ? 'OpenRouter'
            : 'gemini-key',
      );
      const genAiInstance = (service as any).ai;
      genAiInstance.models.generateContent.mockResolvedValue({
        text: 'gemini-cleaned',
      });

      const result = await service.cleanMarkdownContentWithAI('raw');
      expect(genAiInstance.models.generateContent).toHaveBeenCalled();
      expect(result).toBe('gemini-cleaned');
    });

    it('should throw BadRequestException when no platform configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(
        service.cleanMarkdownContentWithAI('raw'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('analyzeMarketTrends', () => {
    it('should return empty string when contentData is empty', async () => {
      expect(await service.analyzeMarketTrends('sys', '')).toBe('');
      expect(await service.analyzeMarketTrends('sys', '   ')).toBe('');
    });

    it('should send system + user messages to OpenRouter', async () => {
      const analysis = 'Market up trend';
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          mockFetchResponse(true, {
            choices: [{ message: { content: analysis } }],
          }),
        );

      const result = await service.analyzeMarketTrends('SYS', 'CONTENT');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          body: expect.stringContaining('"role":"system"'),
        }),
      );
      expect(result).toBe(analysis);
    });

    it('should throw BadRequestException on fetch error', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(mockFetchResponse(false, 'err', 500));

      await expect(
        service.analyzeMarketTrends('SYS', 'CONTENT'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
