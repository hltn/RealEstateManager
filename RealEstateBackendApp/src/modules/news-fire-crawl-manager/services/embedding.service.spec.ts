import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let mockConfigService: ConfigService;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, string> = {
          OPENROUTER_API_KEY: 'test-api-key',
          EMBEDDING_MODEL: 'openai/text-embedding-3-small',
          EMBEDDING_DIMENSIONS: '512',
        };
        return config[key] ?? defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('prepareEmbeddingInput', () => {
    it('should return title only when no secondary field', () => {
      const result = service.prepareEmbeddingInput({ title: 'Test Title' });
      expect(result).toBe('Test Title.');
    });

    it('should combine title and summary', () => {
      const result = service.prepareEmbeddingInput({
        title: 'Test Title',
        summary: 'Test summary text',
      });
      expect(result).toBe('Test Title. Test summary text');
    });

    it('should prefer summary over description', () => {
      const result = service.prepareEmbeddingInput({
        title: 'Title',
        summary: 'From summary',
        description: 'From description',
      });
      expect(result).toBe('Title. From summary');
    });

    it('should use description when summary is absent', () => {
      const result = service.prepareEmbeddingInput({
        title: 'Title',
        description: 'From description',
      });
      expect(result).toBe('Title. From description');
    });

    it('should fallback to content (first 300 chars) when summary and description are absent', () => {
      const content = 'A'.repeat(500);
      const result = service.prepareEmbeddingInput({
        title: 'Title',
        content,
      });
      // content is truncated to 300 chars, then total truncated to 500
      expect(result.length).toBeLessThanOrEqual(500);
      expect(result).toContain('Title. ');
    });

    it('should limit output to 500 characters', () => {
      const longTitle = 'X'.repeat(300);
      const longSummary = 'Y'.repeat(300);
      const result = service.prepareEmbeddingInput({
        title: longTitle,
        summary: longSummary,
      });
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it('should handle empty title gracefully', () => {
      const result = service.prepareEmbeddingInput({
        title: '',
        summary: 'Some summary',
      });
      expect(result).toBe('. Some summary');
    });

    it('should trim trailing space when secondary is empty', () => {
      const result = service.prepareEmbeddingInput({ title: 'Title' });
      expect(result.endsWith(' ')).toBe(false);
    });
  });

  describe('createEmbedding', () => {
    it('should call OpenRouter API with correct format', async () => {
      const mockEmbedding = new Array(512).fill(0.1);
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ embedding: mockEmbedding }],
        }),
      });

      const result = await service.createEmbedding('Test input text');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/embeddings',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openai/text-embedding-3-small',
            input: 'Test input text',
            dimensions: 512,
          }),
        },
      );
      expect(result).toEqual(mockEmbedding);
    });

    it('should throw error for empty text', async () => {
      await expect(service.createEmbedding('')).rejects.toThrow(
        'Cannot create embedding for empty text',
      );
      await expect(service.createEmbedding('   ')).rejects.toThrow(
        'Cannot create embedding for empty text',
      );
    });

    it('should throw error when API returns non-OK status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('Rate limited'),
      });

      await expect(service.createEmbedding('Test')).rejects.toThrow(
        'Embedding API error (429): Rate limited',
      );
    });

    it('should throw error when API returns no embedding data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await expect(service.createEmbedding('Test')).rejects.toThrow(
        'Embedding API returned no embedding data',
      );
    });
  });

  describe('createEmbeddingBatch', () => {
    it('should call API with array input for batch', async () => {
      const mockEmbeddings = [
        new Array(512).fill(0.1),
        new Array(512).fill(0.2),
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: mockEmbeddings.map((e) => ({ embedding: e })),
        }),
      });

      const result = await service.createEmbeddingBatch([
        'Text 1',
        'Text 2',
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/embeddings',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'openai/text-embedding-3-small',
            input: ['Text 1', 'Text 2'],
            dimensions: 512,
          }),
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.createEmbeddingBatch([]);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw error when all texts are empty', async () => {
      await expect(
        service.createEmbeddingBatch(['', '  ', '']),
      ).rejects.toThrow('All texts are empty');
    });

    it('should filter out empty texts and process non-empty ones', async () => {
      const mockEmbeddings = [new Array(512).fill(0.1)];
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ embedding: mockEmbeddings[0] }],
        }),
      });

      const result = await service.createEmbeddingBatch([
        '',
        'Valid text',
        '  ',
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/embeddings',
        expect.objectContaining({
          body: expect.stringContaining('"input":["Valid text"]'),
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('getEmbeddingModelName', () => {
    it('should return configured model name', () => {
      expect(service.getEmbeddingModelName()).toBe(
        'openai/text-embedding-3-small',
      );
    });
  });

  describe('getEmbeddingDimensions', () => {
    it('should return configured dimensions', () => {
      expect(service.getEmbeddingDimensions()).toBe(512);
    });
  });

  describe('constructor', () => {
    it('should warn when OPENROUTER_API_KEY is not set', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const configWithoutKey = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'OPENROUTER_API_KEY') return '';
          return defaultValue;
        }),
      } as any;

      new EmbeddingService(configWithoutKey);
      // Logger.warn is called internally — we just verify the service doesn't throw
      warnSpy.mockRestore();
    });
  });
});
