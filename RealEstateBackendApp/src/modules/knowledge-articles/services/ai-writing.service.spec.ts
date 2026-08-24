import { Test, TestingModule } from '@nestjs/testing';
import { AiWritingService } from './ai-writing.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import { UnifiedAiService } from '../../../shared/ai-provider/unified-ai.service';

describe('AiWritingService', () => {
  let service: AiWritingService;
  let unifiedAiService: UnifiedAiService;

  const mockAiWritingConfig = {
    promptTemplate:
      'Viết bài về {{topic}} trong danh mục {{category}}: {{topicDescription}}',
    model: 'google/gemini-2.5-flash',
    provider: 'Must1c',
    maxTokens: 4096,
    temperature: 0.7,
    topics: [
      {
        slug: 'ha-noi',
        name: 'BĐS Hà Nội',
        description: 'Thị trường bất động sản Hà Nội',
      },
    ],
    articlesPerBatch: 3,
  };

  beforeEach(async () => {
    process.env.MUST1C_API_KEY = 'test-must1c-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiWritingService,
        {
          provide: KnowledgeConfigService,
          useValue: {
            getAiWritingConfig: jest.fn().mockResolvedValue(mockAiWritingConfig),
          },
        },
        {
          provide: UnifiedAiService,
          useValue: {
            resolveFromConfig: jest.fn().mockReturnValue({
              name: 'Must1c',
              url: 'https://htmustc.id.vn/v1/chat/completions',
              apiKey: 'test-must1c-key',
              model: 'google/gemini-2.5-flash',
            }),
            callChatCompletion: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AiWritingService>(AiWritingService);
    unifiedAiService = module.get<UnifiedAiService>(UnifiedAiService);
  });

  afterEach(() => {
    delete process.env.MUST1C_API_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateContent', () => {
    it('should generate content successfully from Must1c', async () => {
      const aiResponse = {
        title: 'Thị trường BĐS Hà Nội 2026',
        content: '# Thị trường BĐS Hà Nội\n\nNội dung bài viết...',
        htmlContent: '<h1>Thị trường BĐS Hà Nội</h1><p>Nội dung bài viết...</p>',
        summary: 'Tổng quan thị trường BĐS Hà Nội năm 2026',
        tags: ['bđs', 'hà nội', 'thị trường'],
      };

      unifiedAiService.callChatCompletion = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(aiResponse),
              },
            },
          ],
        }),
      } as any);

      const result = await service.generateContent({
        topic: 'BĐS Hà Nội',
        category: 'ha-noi',
        topicDescription: 'Thị trường bất động sản Hà Nội',
      });

      expect(result.title).toBe('Thị trường BĐS Hà Nội 2026');
      expect(result.content).toContain('Thị trường BĐS Hà Nội');
      expect(result.tags).toEqual(['bđs', 'hà nội', 'thị trường']);
    });

    it('should throw when prompt template is missing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiWritingService,
          {
            provide: KnowledgeConfigService,
            useValue: {
              getAiWritingConfig: jest.fn().mockResolvedValue({
                promptTemplate: '',
                provider: 'Must1c',
                model: 'test',
              }),
            },
          },
          {
            provide: UnifiedAiService,
            useValue: {
              resolveFromConfig: jest.fn().mockReturnValue({
                name: 'Must1c',
                url: 'https://htmustc.id.vn/v1/chat/completions',
                apiKey: 'test-must1c-key',
                model: 'test',
              }),
              callChatCompletion: jest.fn(),
            },
          },
        ],
      }).compile();

      const svc = module.get<AiWritingService>(AiWritingService);

      await expect(
        svc.generateContent({
          topic: 'Test',
          category: 'test',
          topicDescription: 'Test desc',
        }),
      ).rejects.toThrow('prompt template not configured');
    });

    it('should throw when AI returns empty response', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }],
        }),
      } as any);

      await expect(
        service.generateContent({
          topic: 'Test',
          category: 'test',
          topicDescription: 'Test desc',
        }),
      ).rejects.toThrow('empty response');

      global.fetch = originalFetch;
    });

    it('should retry on 500 errors', async () => {
      let callCount = 0;
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return { ok: false, status: 500, text: async () => 'Server Error' } as any;
        }
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Retry success',
                    content: 'Content after retry',
                  }),
                },
              },
            ],
          }),
        } as any;
      });

      const result = await service.generateContent({
        topic: 'Test',
        category: 'test',
        topicDescription: 'Test desc',
      });

      expect(result.title).toBe('Retry success');
      expect(callCount).toBe(3);

      global.fetch = originalFetch;
    });

    it('should not retry on 400 errors', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as any);

      await expect(
        service.generateContent({
          topic: 'Test',
          category: 'test',
          topicDescription: 'Test desc',
        }),
      ).rejects.toThrow();

      global.fetch = originalFetch;
    });
  });
});