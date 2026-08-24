import { Test, TestingModule } from '@nestjs/testing';
import { AiImageService } from './ai-image.service';
import { KnowledgeConfigService } from './knowledge-config.service';

describe('AiImageService', () => {
  let service: AiImageService;

  const mockImageConfig = {
    enabled: true,
    promptTemplate:
      'Generate a professional image for: {{title}}. Summary: {{content_summary}}. Style: {{style}}',
    model: 'openai/dall-e-3',
    provider: 'OpenRouter',
    width: 1024,
    height: 1024,
    style: 'realistic',
  };

  beforeEach(async () => {
    process.env.OPENROUTER_API_KEY = 'test-image-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageService,
        {
          provide: KnowledgeConfigService,
          useValue: {
            getAiImageConfig: jest.fn().mockResolvedValue(mockImageConfig),
          },
        },
      ],
    }).compile();

    service = module.get<AiImageService>(AiImageService);
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateFeaturedImage', () => {
    it('should generate an image successfully', async () => {
      const mockImageBuffer = Buffer.from('fake-jpeg-data');

      const originalFetch = global.fetch;
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                url: 'https://example.com/image.png',
              },
            ],
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => mockImageBuffer,
        } as any);

      const result = await service.generateFeaturedImage({
        title: 'Test Article',
        contentSummary: 'Summary of the article',
      });

      expect(result.imageUrl).toBe('https://example.com/image.png');
      expect(result.buffer.length).toBeGreaterThan(0);

      global.fetch = originalFetch;
    });

    it('should skip when image generation is disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiImageService,
          {
            provide: KnowledgeConfigService,
            useValue: {
              getAiImageConfig: jest.fn().mockResolvedValue({
                enabled: false,
                promptTemplate: 'test',
                model: 'test',
                provider: 'OpenRouter',
              }),
            },
          },
        ],
      }).compile();

      const svc = module.get<AiImageService>(AiImageService);

      const result = await svc.generateFeaturedImage({
        title: 'Test',
        contentSummary: 'Summary',
      });

      expect(result.imageUrl).toBe('');
      expect(result.buffer.length).toBe(0);
    });

    it('should throw when API returns no image data', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as any);

      await expect(
        service.generateFeaturedImage({
          title: 'Test',
          contentSummary: 'Summary',
        }),
      ).rejects.toThrow('no image data');

      global.fetch = originalFetch;
    });
  });

  describe('generateInlineImages', () => {
    it('should generate images for multiple sections', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          data: [{ url: 'https://example.com/inline.png' }],
        }),
        arrayBuffer: async () => Buffer.from('inline-data'),
      } as any));

      const result = await service.generateInlineImages({
        sections: [
          { heading: 'Section 1', description: 'First section' },
          { heading: 'Section 2', description: 'Second section' },
        ],
      });

      expect(result.length).toBe(2);
      expect(result[0].forSection).toBe('Section 1');

      global.fetch = originalFetch;
    });

    it('should skip when disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiImageService,
          {
            provide: KnowledgeConfigService,
            useValue: {
              getAiImageConfig: jest.fn().mockResolvedValue({
                enabled: false,
              }),
            },
          },
        ],
      }).compile();

      const svc = module.get<AiImageService>(AiImageService);

      const result = await svc.generateInlineImages({
        sections: [{ heading: 'A', description: 'B' }],
      });

      expect(result).toEqual([]);
    });
  });
});
