import { Test, TestingModule } from '@nestjs/testing';
import { WpClientService } from './wp-client.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WpClientService', () => {
  let service: WpClientService;
  let configService: KnowledgeConfigService;

  const mockConfig = {
    siteUrl: 'https://example.com',
    username: 'admin',
    appPassword: 'xxxx xxxx xxxx xxxx',
    defaultCategoryId: 15,
    categoryMapping: [
      { slug: 'ha-noi', wpCategoryId: 16, wpCategoryName: 'BĐS Hà Nội' },
    ],
    defaultTagIds: [1, 2],
    tagMapping: [{ name: 'chung cư', wpTagId: 1 }],
  };

  const mockAxiosInstance = {
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WpClientService,
        {
          provide: KnowledgeConfigService,
          useValue: {
            getWpConfig: jest.fn().mockResolvedValue(mockConfig),
          },
        },
      ],
    }).compile();

    service = module.get<WpClientService>(WpClientService);
    configService = module.get<KnowledgeConfigService>(KnowledgeConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyConnection', () => {
    it('should return valid when connection works', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { name: 'Test Site' },
      });

      const result = await service.verifyConnection();

      expect(result.valid).toBe(true);
      expect(result.siteName).toBe('Test Site');
    });

    it('should return invalid when connection fails', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      const result = await service.verifyConnection();

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('getCategories', () => {
    it('should fetch categories from WP', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: [
          { id: 1, name: 'News', slug: 'news' },
          { id: 2, name: 'Real Estate', slug: 'real-estate' },
        ],
      });

      const result = await service.getCategories();

      expect(result).toEqual([
        { id: 1, name: 'News', slug: 'news' },
        { id: 2, name: 'Real Estate', slug: 'real-estate' },
      ]);
    });
  });

  describe('uploadMedia', () => {
    it('should upload media and return id/url', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 42,
          source_url: 'https://example.com/wp-content/uploads/test.jpg',
        },
      });

      const result = await service.uploadMedia(
        Buffer.from('fake-image'),
        'test.jpg',
        'image/jpeg',
      );

      expect(result.mediaId).toBe(42);
      expect(result.mediaUrl).toContain('test.jpg');
    });
  });

  describe('createPost', () => {
    it('should create a WP post and return postId/postUrl', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 100,
          link: 'https://example.com/test-post/',
        },
      });

      const result = await service.createPost({
        title: 'Test Post',
        content: '<p>Hello</p>',
        status: 'publish',
        categories: [1],
        tags: [2],
        featuredMedia: 42,
      });

      expect(result.postId).toBe(100);
      expect(result.postUrl).toBe('https://example.com/test-post/');
    });
  });

  describe('updatePost', () => {
    it('should update a WP post', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          id: 100,
          link: 'https://example.com/updated/',
        },
      });

      const result = await service.updatePost(100, {
        title: 'Updated Title',
      });

      expect(result.postId).toBe(100);
    });
  });

  describe('getOrCreateTag', () => {
    it('should return existing tag ID when found', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: [{ id: 5, name: 'chung cư' }],
      });

      const result = await service.getOrCreateTag('chung cư');

      expect(result).toBe(5);
    });

    it('should create new tag when not found', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });
      mockAxiosInstance.post.mockResolvedValue({
        data: { id: 99, name: 'new tag' },
      });

      const result = await service.getOrCreateTag('new tag');

      expect(result).toBe(99);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tags', {
        name: 'new tag',
      });
    });
  });
});
