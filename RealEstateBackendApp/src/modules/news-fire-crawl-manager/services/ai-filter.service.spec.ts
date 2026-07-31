jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));
// Lưu ý: Gemini native SDK (@google/genai) đã được bỏ khỏi service (commit
// 97bb5c2 "remove Gemini SDK"). Service hiện chỉ dùng OpenRouter/Must1c qua
// fetch — không còn fallback Gemini native. Do đó không mock @google/genai nữa.

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { ConfigService } from '@nestjs/config';

/**
 * Unit test cho AIFilterService — service gọi AI (OpenRouter/Must1c/Gemini).
 * Mock fetch global + fs để cô lập logic branching theo platform (OpenRouter/Must1c).
 */
describe('AIFilterService', () => {
  let service: AIFilterService;
  let mockConfigService: any;
  let mockAiPromptConfigService: any;
  const mockFs = fs as jest.Mocked<typeof fs>;

  // Service có fallback `configService.get(...) || process.env.*` cho các key
  // AI platform. Nếu CI load .env có set các key này, test "no key" có thể
  // pass vì lý do sai (không throw) hoặc fail bất thường. Stub process.env
  // trong scope test để deterministic, khôi phục lại ở afterEach.
  const ENV_KEYS = [
    'OPENROUTER_API_KEY',
    'OPENROUTER_AI_MODEL',
    'ACTIVE_AI_PLATFORM',
    'MUST1C_API_KEY',
    'MUST1C_MODEL',
    'MUST1C_API_URL',
    'GEMINI_API_KEY',
  ] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Xóa các env key AI khỏi process.env — lưu giá trị gốc để restore.
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }

    // Cấu hình mặc định: có OpenRouter
    mockConfigService = {
      get: jest.fn((key: string) => {
        const cfg: Record<string, string> = {
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

  afterEach(() => {
    jest.restoreAllMocks();
    // Khôi phục process.env về trạng thái gốc sau khi stub.
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k] as string;
    }
  });

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

    it('should throw BadRequestException when no OpenRouter key (no Gemini fallback)', async () => {
      // Sau commit 97bb5c2 (remove Gemini SDK), service không còn fallback
      // Gemini native API. Khi thiếu OpenRouter key → throw BadRequestException
      // ngay lập tức (contract hiện tại của service).
      mockConfigService.get.mockReturnValue(undefined);

      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        BadRequestException,
      );
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

    it('should throw BadRequestException when no OpenRouter/Must1c key (no Gemini fallback)', async () => {
      // Sau commit 97bb5c2 (remove Gemini SDK), service không còn fallback
      // Gemini native API. Khi không có OpenRouter/Must1c key và platform
      // = OpenRouter → throw BadRequestException ('No AI platform configured').
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'OPENROUTER_API_KEY'
          ? undefined
          : key === 'ACTIVE_AI_PLATFORM'
            ? 'OpenRouter'
            : undefined,
      );

      await expect(
        service.cleanMarkdownContentWithAI('raw'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no platform configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(
        service.cleanMarkdownContentWithAI('raw'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('callAiCompletion', () => {
    it('should return empty string when contentData is empty', async () => {
      expect(
        await service.callAiCompletion('sys', '', 'Market trends analysis'),
      ).toBe('');
      expect(
        await service.callAiCompletion('sys', '   ', 'Extract listings'),
      ).toBe('');
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

      const result = await service.callAiCompletion(
        'SYS',
        'CONTENT',
        'Market trends analysis',
      );
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
        service.callAiCompletion('SYS', 'CONTENT', 'Extract listings'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
