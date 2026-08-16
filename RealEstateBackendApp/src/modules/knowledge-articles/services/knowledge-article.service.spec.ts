/**
 * KnowledgeArticleService unit tests.
 *
 * Mocks the Mongoose Model and tests:
 * - listArticles: pagination, filtering by status/category/search, sort order
 * - getArticleById: returns knowledge article (with deletedAt: null filter), throws NotFoundException
 * - deleteArticle: sets deletedAt
 * - deleteBulkArticles: bulk soft delete (with deletedAt: null filter)
 * - updateState: updates pipeline state + extra fields
 * - markFailed: sets failed state + step + error
 * - publishToWordPress: validates state, stubs publish
 * - republishToWordPress: validates wpPostId exists
 * - retryArticle: resumes pipeline from failed step (M-03: now runs inline)
 * - createBatchArticles: creates articles with correct fields
 */

const mockLean = jest.fn();
const mockExec = jest.fn();
const mockFind = jest.fn(() => ({ sort: jest.fn(() => ({ skip: jest.fn(() => ({ limit: jest.fn(() => ({ lean: mockLean })) })) })) }));
const mockFindOne = jest.fn(() => ({ lean: mockLean }));
const mockCountDocuments = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(0) }));
const mockUpdateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }));
const mockUpdateMany = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }));
const mockCreate = jest.fn();

const mockModel = {
  find: mockFind,
  findOne: mockFindOne,
  countDocuments: mockCountDocuments,
  updateOne: mockUpdateOne,
  updateMany: mockUpdateMany,
  create: mockCreate,
};

const mockWpClientService = {
  createPost: jest.fn().mockResolvedValue({ postId: 42, postUrl: 'https://example.com/test' }),
  updatePost: jest.fn().mockResolvedValue({ postId: 42, postUrl: 'https://example.com/test' }),
  verifyConnection: jest.fn(),
  uploadMedia: jest.fn(),
};

const mockAiWritingService = {
  generateContent: jest.fn().mockResolvedValue({
    title: 'AI Generated Title',
    content: 'AI generated content',
    htmlContent: '<p>AI generated content</p>',
    summary: 'AI summary',
  }),
  markdownToHtml: jest.fn().mockReturnValue('<p>converted</p>'),
};

const mockAiImageService = {
  generateFeaturedImage: jest.fn().mockResolvedValue({
    imageUrl: 'https://example.com/image.jpg',
    buffer: Buffer.from('fake-image'),
  }),
};

import { KnowledgeArticleService } from './knowledge-article.service';
import { KnowledgeArticleState } from '../types/knowledge-article-state';

describe('KnowledgeArticleService', () => {
  let service: KnowledgeArticleService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLean.mockReturnValue({ exec: mockExec });
    mockExec.mockResolvedValue(null);
    service = new KnowledgeArticleService(
      mockModel as never,
      mockWpClientService as never,
      mockAiWritingService as never,
      mockAiImageService as never,
    );
  });

  describe('getArticleById', () => {
    it('returns article when found', async () => {
      const fakeArticle = { _id: 'abc', title: 'Test', type: 'knowledge' };
      mockExec.mockResolvedValue(fakeArticle);

      const result = await service.getArticleById('abc');

      // C-01: query must include deletedAt: null
      expect(mockFindOne).toHaveBeenCalledWith({ _id: 'abc', type: 'knowledge', deletedAt: null });
      expect(result).toEqual(fakeArticle);
    });

    it('throws NotFoundException when not found', async () => {
      mockExec.mockResolvedValue(null);

      await expect(service.getArticleById('nonexistent')).rejects.toThrow(
        'Knowledge article not found',
      );
    });
  });

  describe('listArticles', () => {
    it('returns paginated results with default params', async () => {
      const articles = [{ title: 'A' }, { title: 'B' }];
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockExec.mockResolvedValue(articles);
      mockCountDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(10),
      });

      const result = await service.listArticles({});

      expect(result.data).toEqual(articles);
      expect(result.meta.total).toBe(10);
      expect(result.meta.page).toBe(1);
    });

    it('includes deletedAt: null in filter (C-01)', async () => {
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockExec.mockResolvedValue([]);
      mockCountDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.listArticles({});

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: null }),
      );
    });

    it('filters by status', async () => {
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockExec.mockResolvedValue([]);
      mockCountDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.listArticles({
        status: KnowledgeArticleState.READY,
      });

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({ pipelineState: KnowledgeArticleState.READY }),
      );
    });

    it('filters by category', async () => {
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockExec.mockResolvedValue([]);
      mockCountDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.listArticles({ category: 'ha-noi' });

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({ categorySlug: 'ha-noi' }),
      );
    });

    it('searches by title', async () => {
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockExec.mockResolvedValue([]);
      mockCountDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.listArticles({ search: 'test query' });

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({
          title: { $regex: 'test query', $options: 'i' },
        }),
      );
    });
  });

  describe('markFailed', () => {
    it('sets failed state with step and error', async () => {
      await service.markFailed('abc', 2, 'AI timeout');

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: 'abc' },
        {
          $set: {
            pipelineState: KnowledgeArticleState.FAILED,
            pipelineFailedStep: 2,
            pipelineError: 'AI timeout',
          },
        },
      );
    });
  });

  describe('deleteArticle', () => {
    it('throws NotFoundException for non-existent article', async () => {
      mockExec.mockResolvedValue(null);

      await expect(service.deleteArticle('nonexistent')).rejects.toThrow(
        'Knowledge article not found',
      );
    });

    it('sets deletedAt on existing article', async () => {
      mockExec.mockResolvedValueOnce({ _id: 'abc' }); // findOne
      mockExec.mockResolvedValueOnce({ modifiedCount: 1 }); // updateOne

      await service.deleteArticle('abc');

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: 'abc' },
        expect.objectContaining({ $set: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });

  describe('deleteBulkArticles', () => {
    it('bulk soft deletes articles and returns count', async () => {
      const mockExecBulk = jest.fn().mockResolvedValue({ modifiedCount: 3 });
      mockUpdateMany.mockReturnValue({ exec: mockExecBulk });

      const result = await service.deleteBulkArticles(['id1', 'id2', 'id3']);

      expect(result.deletedCount).toBe(3);
      // C-01: bulk delete must filter deletedAt: null
      expect(mockUpdateMany).toHaveBeenCalledWith(
        {
          _id: { $in: ['id1', 'id2', 'id3'] },
          type: 'knowledge',
          deletedAt: null,
        },
        expect.any(Object),
      );
    });

    it('does not include already-deleted articles in bulk delete scope (C-01)', async () => {
      const mockExecBulk = jest.fn().mockResolvedValue({ modifiedCount: 0 });
      mockUpdateMany.mockReturnValue({ exec: mockExecBulk });

      await service.deleteBulkArticles(['deleted-id']);

      // Verify deletedAt: null is in the filter — already-deleted articles are excluded
      const filterArg = mockUpdateMany.mock.calls[0][0];
      expect(filterArg.deletedAt).toBe(null);
    });
  });

  describe('retryArticle (M-03)', () => {
    it('throws BadRequestException when article is not in failed state', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.READY,
        pipelineFailedStep: null,
      });

      await expect(service.retryArticle('abc')).rejects.toThrow(
        'Only articles in "failed" state can be retried',
      );
    });

    it('re-runs pipeline inline when failed at step 1 (M-03)', async () => {
      // Call sequence for retryArticle:
      // 1. getArticleById — check state (FAILED)
      // 2. updateState → GENERATING_CONTENT
      // 3. aiWritingService.generateContent
      // 4. updateState → CONTENT_READY
      // 5. getArticleById — reload for image step
      // 6. aiImageService.generateFeaturedImage
      // 7. updateState → READY
      // 8. updateOne — clear error fields
      // 9. getArticleById — reload before publish
      // 10. publishToWordPress uses preloaded (no extra findOne)
      // 11. updateState → PUBLISHING
      // 12. wpClientService.createPost
      // 13. updateState → PUBLISHED
      mockExec
        .mockResolvedValueOnce({
          _id: 'abc',
          pipelineState: KnowledgeArticleState.FAILED,
          pipelineFailedStep: 1,
          title: 'Test Topic',
          categorySlug: 'ha-noi',
          featuredImageUrl: null,
        })
        .mockResolvedValueOnce({
          _id: 'abc',
          title: 'Test Topic',
          categorySlug: 'ha-noi',
          featuredImageUrl: null,
          summary: 'AI summary',
          content: 'AI content',
        })
        .mockResolvedValueOnce({
          _id: 'abc',
          pipelineState: KnowledgeArticleState.READY,
          title: 'AI Generated Title',
          content: 'AI generated content',
          htmlContent: '<p>AI generated content</p>',
          wpCategoryId: 16,
          wpTagIds: [],
        })
        .mockResolvedValue({ _id: 'abc' });

      const result = await service.retryArticle('abc');

      expect(result.success).toBe(true);
      expect(result.failedStep).toBe(1);
      // Should have called AI writing service
      expect(mockAiWritingService.generateContent).toHaveBeenCalled();
      // Should have called AI image service
      expect(mockAiImageService.generateFeaturedImage).toHaveBeenCalled();
      // Should have called WP publish
      expect(mockWpClientService.createPost).toHaveBeenCalled();
    });

    it('skips content regen when failed at step 3 (M-03)', async () => {
      // Call sequence for failedStep=3:
      // 1. getArticleById — check state (FAILED)
      // 2. getArticleById — reload for image step (step 3 check)
      // 3. aiImageService.generateFeaturedImage
      // 4. updateState → READY
      // 5. updateOne — clear error fields
      // 6. getArticleById — reload before publish
      // 7. publishToWordPress uses preloaded (no extra findOne)
      // 8. updateState → PUBLISHING
      // 9. wpClientService.createPost
      // 10. updateState → PUBLISHED
      mockExec
        .mockResolvedValueOnce({
          _id: 'abc',
          pipelineState: KnowledgeArticleState.FAILED,
          pipelineFailedStep: 3,
          title: 'Test Topic',
          categorySlug: 'ha-noi',
          featuredImageUrl: null,
          content: 'Existing content',
          summary: 'Existing summary',
        })
        .mockResolvedValueOnce({
          _id: 'abc',
          title: 'Test Topic',
          featuredImageUrl: null,
          summary: 'Existing summary',
          content: 'Existing content',
        })
        .mockResolvedValueOnce({
          _id: 'abc',
          pipelineState: KnowledgeArticleState.READY,
          title: 'Test Topic',
          content: 'Existing content',
          htmlContent: '<p>Existing content</p>',
          wpCategoryId: 16,
          wpTagIds: [],
        })
        .mockResolvedValue({ _id: 'abc' });

      const result = await service.retryArticle('abc');

      expect(result.success).toBe(true);
      expect(result.failedStep).toBe(3);
      // Should NOT call AI writing (step 3 means content was ready)
      expect(mockAiWritingService.generateContent).not.toHaveBeenCalled();
      // Should call AI image service
      expect(mockAiImageService.generateFeaturedImage).toHaveBeenCalled();
    });

    it('marks article as failed on retry error (M-03)', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.FAILED,
        pipelineFailedStep: 1,
        title: 'Test Topic',
        categorySlug: 'ha-noi',
      });

      // Make AI service throw
      mockAiWritingService.generateContent.mockRejectedValueOnce(
        new Error('AI service down'),
      );

      await expect(service.retryArticle('abc')).rejects.toThrow(
        'Retry failed at step 1',
      );

      // Should re-mark as failed
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: 'abc' },
        expect.objectContaining({
          $set: expect.objectContaining({
            pipelineState: KnowledgeArticleState.FAILED,
          }),
        }),
      );
    });
  });

  describe('publishToWordPress', () => {
    it('throws BadRequestException when article is not in ready state', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.CONTENT_READY,
      });

      await expect(service.publishToWordPress('abc')).rejects.toThrow(
        'Only articles in "ready" state can be published',
      );
    });

    it('calls wpClientService.createPost and marks article as published', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.READY,
        title: 'Test Article',
        content: 'Some content',
        htmlContent: '<p>Some content</p>',
        wpCategoryId: 16,
        wpTagIds: [1, 2],
        wpMediaId: 42,
      });
      mockUpdateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

      const result = await service.publishToWordPress('abc');

      expect(mockWpClientService.createPost).toHaveBeenCalledWith({
        title: 'Test Article',
        content: '<p>Some content</p>',
        status: 'publish',
        categories: [16],
        tags: [1, 2],
        featuredMedia: 42,
      });
      expect(result.wpPostId).toBe(42);
    });

    it('reverts to READY state when WP publish fails', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.READY,
        title: 'Test Article',
        content: 'content',
        htmlContent: '<p>content</p>',
        wpCategoryId: 16,
        wpTagIds: [],
      });
      mockWpClientService.createPost.mockRejectedValueOnce(new Error('WP auth failed'));

      await expect(service.publishToWordPress('abc')).rejects.toThrow(
        'WordPress publish failed',
      );

      // Should have been called twice: once for PUBLISHING, once for revert to READY
      expect(mockUpdateOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('republishToWordPress', () => {
    it('throws when article has no wpPostId', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.PUBLISHED,
        wpPostId: null,
      });

      await expect(service.republishToWordPress('abc')).rejects.toThrow(
        'Article has not been published to WordPress yet',
      );
    });

    it('calls wpClientService.updatePost successfully', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.PUBLISHED,
        wpPostId: 100,
        title: 'Updated Title',
        content: 'Updated content',
        htmlContent: '<p>Updated content</p>',
        wpCategoryId: 17,
        wpTagIds: [3],
      });
      mockUpdateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

      const result = await service.republishToWordPress('abc');

      expect(mockWpClientService.updatePost).toHaveBeenCalledWith(100, {
        title: 'Updated Title',
        content: '<p>Updated content</p>',
        categories: [17],
        tags: [3],
      });
      expect(result.wpPostId).toBe(100);
    });
  });

  describe('createBatchArticles', () => {
    it('creates articles with correct fields', async () => {
      const topics = [
        { title: 'Article 1', categorySlug: 'ha-noi', wpCategoryId: 16 },
        { title: 'Article 2', categorySlug: 'hcm', wpCategoryId: 17 },
      ];

      mockCreate.mockImplementation((doc) =>
        Promise.resolve({ ...doc, _id: 'generated-id' }),
      );

      const result = await service.createBatchArticles('batch-1', topics);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Article 1',
          type: 'knowledge',
          pipelineState: KnowledgeArticleState.PENDING,
          categorySlug: 'ha-noi',
          wpCategoryId: 16,
          batchId: 'batch-1',
        }),
      );
    });
  });
});
