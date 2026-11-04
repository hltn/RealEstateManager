jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { UnifiedAiService } from '../../../shared/ai-provider/unified-ai.service';

/**
 * Unit test cho AIFilterService.
 *
 * Service chỉ phụ thuộc UnifiedAiService (resolveProvider / callChatCompletion /
 * httpErrorDescription) và AiPromptConfigService. Việc chọn platform
 * (Must1c / 9Router) và gọi HTTP nằm trong UnifiedAiService (có spec riêng),
 * nên ở đây mock UnifiedAiService để cô lập logic của AIFilterService:
 * dựng prompt, parse JSON, map lỗi, timeout.
 */
describe('AIFilterService', () => {
  let service: AIFilterService;
  let mockUnifiedAiService: {
    resolveProvider: jest.Mock;
    callChatCompletion: jest.Mock;
    httpErrorDescription: jest.Mock;
  };
  let mockAiPromptConfigService: { getPromptByName: jest.Mock };
  const mockFs = fs as jest.Mocked<typeof fs>;

  const PROVIDER = {
    name: 'Must1c',
    url: 'https://htmustc.id.vn/v1/chat/completions',
    apiKey: 'm1c-key',
    model: 'gemini-3.6-flash',
  };

  // Helper tạo mock Response cho callChatCompletion (service chỉ dùng ok/status/json/text).
  const mockAiResponse = (content: string): Response =>
    ({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content } }],
      }),
    }) as unknown as Response;

  const mockErrorResponse = (status: number, body: unknown): Response =>
    ({
      ok: false,
      status,
      text: jest
        .fn()
        .mockResolvedValue(
          typeof body === 'string' ? body : JSON.stringify(body),
        ),
    }) as unknown as Response;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockUnifiedAiService = {
      resolveProvider: jest.fn().mockReturnValue(PROVIDER),
      callChatCompletion: jest.fn(),
      httpErrorDescription: jest
        .fn()
        .mockImplementation((status: number) => `desc-${status}`),
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
        { provide: UnifiedAiService, useValue: mockUnifiedAiService },
        { provide: AiPromptConfigService, useValue: mockAiPromptConfigService },
      ],
    }).compile();

    service = module.get<AIFilterService>(AIFilterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('filterAndRank', () => {
    it('should call AI with provider/model and return JSON parsed from markdown fence', async () => {
      const top5 = [{ url: 'https://x', title: 'T1', score: 9 }];
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse('```json\n' + JSON.stringify(top5) + '\n```'),
      );

      const result = await service.filterAndRank('file.json');

      expect(result).toEqual(top5);
      expect(mockAiPromptConfigService.getPromptByName).toHaveBeenCalledWith(
        'FILTER_AND_RANK_PROMPT',
      );
      const [payload, options] =
        mockUnifiedAiService.callChatCompletion.mock.calls[0];
      expect(payload.model).toBe(PROVIDER.model);
      expect(payload.messages).toEqual([
        {
          role: 'user',
          content: expect.stringContaining(
            'SYSTEM_PROMPT' + 'URL: https://x\nTitle: T1\nContent: C1',
          ),
        },
      ]);
      expect(options).toEqual(
        expect.objectContaining({
          provider: PROVIDER,
          contextLabel: 'filterAndRank',
        }),
      );
    });

    it('should extract the nested array when AI wraps the result in an object', async () => {
      const articles = [{ url: 'https://x', title: 'T1' }];
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse(JSON.stringify({ articles })),
      );

      await expect(service.filterAndRank('file.json')).resolves.toEqual(
        articles,
      );
    });

    it('should throw BadRequestException with status description when AI returns non-ok response', async () => {
      // Hành vi hiện tại, cần thống nhất: filterAndRank bọc BadRequestException.
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockErrorResponse(401, { error: { message: 'invalid key' } }),
      );

      const promise = service.filterAndRank('file.json');
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(
        /Must1c API error: 401 - desc-401\. Details: invalid key/,
      );
    });

    it('should throw BadRequestException when AI returns invalid JSON', async () => {
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse('not-json-text'),
      );

      const promise = service.filterAndRank('file.json');
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(/JSON parsing failed/);
    });

    it('should wrap timeout (AbortError) into BadRequestException', async () => {
      mockUnifiedAiService.callChatCompletion.mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );

      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        /timed out after 300 seconds/,
      );
    });

    it('should propagate provider-resolution error when no AI platform configured', async () => {
      mockUnifiedAiService.resolveProvider.mockImplementation(() => {
        throw new BadRequestException('No AI platform configured');
      });

      await expect(service.filterAndRank('file.json')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUnifiedAiService.callChatCompletion).not.toHaveBeenCalled();
    });

    it('should wrap readFileSync error in BadRequestException', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('file missing');
      });

      const promise = service.filterAndRank('file.json');
      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(/file missing/i);
      expect(mockUnifiedAiService.callChatCompletion).not.toHaveBeenCalled();
    });
  });

  describe('filterRawArticles', () => {
    it('should return empty array without calling AI when input is empty', async () => {
      const result = await service.filterRawArticles([]);

      expect(result).toEqual([]);
      expect(mockUnifiedAiService.callChatCompletion).not.toHaveBeenCalled();
    });

    it('should send articles (urlHash falls back to _id) and return parsed result', async () => {
      const parsed = [{ urlHash: 'h1', title: 'T1', reason: 'match' }];
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse(JSON.stringify(parsed)),
      );

      const result = await service.filterRawArticles([
        { _id: 'a', urlHash: 'h1', title: 'T1', description: 'D1' },
        { _id: 'b', title: 'T2' },
      ]);

      expect(result).toEqual(parsed);
      expect(mockAiPromptConfigService.getPromptByName).toHaveBeenCalledWith(
        'RAW_ARTICLES_PROMPT',
      );
      const [payload, options] =
        mockUnifiedAiService.callChatCompletion.mock.calls[0];
      const content: string = payload.messages[0].content;
      expect(content).toContain('urlHash: h1\nTitle: T1\nDescription: D1');
      expect(content).toContain('urlHash: b\nTitle: T2\nDescription: ');
      expect(options.contextLabel).toBe('filterRawArticles');
    });

    it('should map 401 to authentication error description', async () => {
      mockUnifiedAiService.httpErrorDescription.mockReturnValue(
        'Invalid API key (authentication_error)',
      );
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockErrorResponse(401, 'invalid key'),
      );

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow(
        /Must1c API error: 401 - Invalid API key \(authentication_error\)\. Details: invalid key/,
      );
      expect(mockUnifiedAiService.httpErrorDescription).toHaveBeenCalledWith(
        401,
      );
    });

    it('should propagate provider-resolution error when no AI platform configured', async () => {
      mockUnifiedAiService.resolveProvider.mockImplementation(() => {
        throw new BadRequestException('No AI platform configured');
      });

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow(BadRequestException);
      expect(mockUnifiedAiService.callChatCompletion).not.toHaveBeenCalled();
    });

    it('should throw when AI returns invalid JSON', async () => {
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse('not-json-text'),
      );

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow(/JSON parsing failed/);
    });

    it('should throw timeout error when request is aborted', async () => {
      mockUnifiedAiService.callChatCompletion.mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );

      await expect(
        service.filterRawArticles([{ _id: 'a', title: 'T' }]),
      ).rejects.toThrow('AI API request timed out after 300 seconds');
    });
  });

  describe('cleanMarkdownContentWithAI', () => {
    it('should return empty string without calling AI when markdown is empty', async () => {
      expect(await service.cleanMarkdownContentWithAI('')).toBe('');
      expect(await service.cleanMarkdownContentWithAI('   ')).toBe('');
      expect(mockUnifiedAiService.callChatCompletion).not.toHaveBeenCalled();
    });

    it('should return cleaned content and include markdown in prompt', async () => {
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse('Cleaned text'),
      );

      const result = await service.cleanMarkdownContentWithAI('raw md');

      expect(result).toBe('Cleaned text');
      const [payload, options] =
        mockUnifiedAiService.callChatCompletion.mock.calls[0];
      expect(payload.messages[0].content).toBe('SYSTEM_PROMPT\nraw md');
      expect(options.contextLabel).toBe('cleanMarkdownContentWithAI');
    });

    it('should strip markdown code fences from response', async () => {
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse('```markdown\ncleaned\n```'),
      );

      expect(await service.cleanMarkdownContentWithAI('raw')).toBe('cleaned');
    });

    it('should return empty string when AI returns no content', async () => {
      mockUnifiedAiService.callChatCompletion.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ choices: [] }),
      } as unknown as Response);

      expect(await service.cleanMarkdownContentWithAI('raw')).toBe('');
    });

    it('should propagate provider-resolution error when no AI platform configured', async () => {
      mockUnifiedAiService.resolveProvider.mockImplementation(() => {
        throw new BadRequestException('No AI platform configured');
      });

      await expect(service.cleanMarkdownContentWithAI('raw')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('callAiCompletion', () => {
    it('should return empty string without calling AI when contentData is empty', async () => {
      expect(
        await service.callAiCompletion('sys', '', 'Market trends analysis'),
      ).toBe('');
      expect(
        await service.callAiCompletion('sys', '   ', 'Extract listings'),
      ).toBe('');
      expect(mockUnifiedAiService.callChatCompletion).not.toHaveBeenCalled();
    });

    it('should send system + user messages with the given context label', async () => {
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockAiResponse('Market up trend'),
      );

      const result = await service.callAiCompletion(
        'SYS',
        'CONTENT',
        'Market trends analysis',
      );

      expect(result).toBe('Market up trend');
      expect(mockUnifiedAiService.callChatCompletion).toHaveBeenCalledWith(
        {
          model: PROVIDER.model,
          messages: [
            { role: 'system', content: 'SYS' },
            { role: 'user', content: 'CONTENT' },
          ],
        },
        expect.objectContaining({
          provider: PROVIDER,
          contextLabel: 'Market trends analysis',
          prompt: 'SYS\nCONTENT',
        }),
      );
    });

    it('should throw descriptive error when AI returns non-ok response', async () => {
      // Hành vi hiện tại, cần thống nhất: hàm này (và filterRawArticles/cleanMarkdown) ném Error thường, không bọc BadRequestException.
      mockUnifiedAiService.callChatCompletion.mockResolvedValue(
        mockErrorResponse(500, 'err'),
      );

      await expect(
        service.callAiCompletion('SYS', 'CONTENT', 'Extract listings'),
      ).rejects.toThrow(/Must1c API error: 500 - desc-500\. Details: err/);
    });
  });
});
