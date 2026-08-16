import { Test, TestingModule } from '@nestjs/testing';
import { CategoryRotationService } from './category-rotation.service';
import { PipelineLogService } from './pipeline-log.service';
import { KnowledgeConfigService } from './knowledge-config.service';

describe('CategoryRotationService', () => {
  let service: CategoryRotationService;

  const mockPipelineLogService = {
    listLogs: jest.fn(),
  };

  const mockKnowledgeConfigService = {
    getAiWritingConfig: jest.fn().mockResolvedValue({
      topics: [
        { slug: 'ha-noi', name: 'BĐS Hà Nội', description: 'Thị trường Hà Nội' },
        { slug: 'hcm', name: 'BĐS HCM', description: 'Thị trường HCM' },
        { slug: 'da-nang', name: 'BĐS Đà Nẵng', description: 'Thị trường Đà Nẵng' },
      ],
    }),
    getWpConfig: jest.fn().mockResolvedValue({
      categoryMapping: [
        { slug: 'ha-noi', wpCategoryId: 16, wpCategoryName: 'BĐS Hà Nội' },
        { slug: 'hcm', wpCategoryId: 17, wpCategoryName: 'BĐS HCM' },
        { slug: 'da-nang', wpCategoryId: 18, wpCategoryName: 'BĐS Đà Nẵng' },
      ],
      defaultCategoryId: 15,
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPipelineLogService.listLogs.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryRotationService,
        {
          provide: PipelineLogService,
          useValue: mockPipelineLogService,
        },
        {
          provide: KnowledgeConfigService,
          useValue: mockKnowledgeConfigService,
        },
      ],
    }).compile();

    service = module.get<CategoryRotationService>(CategoryRotationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('pickCategory', () => {
    it('should return first topic when no recent logs exist', async () => {
      const result = await service.pickCategory();

      expect(result.topic.slug).toBe('ha-noi');
      expect(result.wpCategoryId).toBe(16);
      expect(result.rotationIndex).toBeDefined();
    });

    it('should skip recently used categories (round-robin)', async () => {
      mockPipelineLogService.listLogs.mockResolvedValue({
        data: [
          { categorySlug: 'ha-noi' },
          { categorySlug: 'hcm' },
        ],
        meta: { page: 1, limit: 3, total: 2, totalPages: 1 },
      });

      const result = await service.pickCategory();

      expect(result.topic.slug).toBe('da-nang');
      expect(result.wpCategoryId).toBe(18);
    });

    it('should use explicit category when overrideSlug is provided', async () => {
      const result = await service.pickCategory('hcm');

      expect(result.topic.slug).toBe('hcm');
      expect(result.wpCategoryId).toBe(17);
    });

    it('should fallback to rotation when overrideSlug is invalid', async () => {
      const result = await service.pickCategory('non-existent');

      // Should fall back to rotation (first topic since no logs)
      expect(result.topic.slug).toBe('ha-noi');
    });

    it('should throw when no topics are configured', async () => {
      mockKnowledgeConfigService.getAiWritingConfig.mockResolvedValue({});

      await expect(service.pickCategory()).rejects.toThrow(
        'No topics configured',
      );
    });

    it('should throw when topics array is empty', async () => {
      mockKnowledgeConfigService.getAiWritingConfig.mockResolvedValue({
        topics: [],
      });

      await expect(service.pickCategory()).rejects.toThrow(
        'No topics configured',
      );
    });

    it('should use defaultCategoryId when slug not in categoryMapping', async () => {
      mockKnowledgeConfigService.getAiWritingConfig.mockResolvedValue({
        topics: [
          { slug: 'unknown-topic', name: 'Unknown', description: 'Test' },
        ],
      });

      const result = await service.pickCategory();

      expect(result.wpCategoryId).toBe(15); // defaultCategoryId
    });

    it('should pick least-used category when all were used recently', async () => {
      // Override getAiWritingConfig to return all 3 topics
      mockKnowledgeConfigService.getAiWritingConfig.mockResolvedValue({
        topics: [
          { slug: 'ha-noi', name: 'BĐS Hà Nội', description: 'Thị trường Hà Nội' },
          { slug: 'hcm', name: 'BĐS HCM', description: 'Thị trường HCM' },
          { slug: 'da-nang', name: 'BĐS Đà Nẵng', description: 'Thị trường Đà Nẵng' },
        ],
      });

      // All 3 categories were used recently
      mockPipelineLogService.listLogs
        .mockResolvedValueOnce({
          data: [
            { categorySlug: 'ha-noi' },
            { categorySlug: 'hcm' },
            { categorySlug: 'da-nang' },
          ],
          meta: { page: 1, limit: 3, total: 3, totalPages: 1 },
        })
        .mockResolvedValueOnce({
          data: [
            { categorySlug: 'ha-noi' },
            { categorySlug: 'ha-noi' },
            { categorySlug: 'hcm' },
            { categorySlug: 'da-nang' },
          ],
          meta: { page: 1, limit: 1000, total: 4, totalPages: 1 },
        });

      const result = await service.pickCategory();

      // hcm has 1 usage, da-nang has 1, ha-noi has 2
      // Should pick one of the least-used (hcm or da-nang)
      expect(['hcm', 'da-nang']).toContain(result.topic.slug);
    });
  });

  describe('getRotationState', () => {
    it('should return current rotation state', () => {
      const state = service.getRotationState();
      expect(state.currentIndex).toBeDefined();
      expect(typeof state.currentIndex).toBe('number');
    });
  });

  describe('resetRotation', () => {
    it('should reset rotation index to 0', () => {
      service.resetRotation();
      const state = service.getRotationState();
      expect(state.currentIndex).toBe(0);
    });
  });
});
