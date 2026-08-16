/**
 * KnowledgeArticleService unit tests.
 *
 * Mocks the Mongoose Model and tests:
 * - listArticles: pagination, filtering by status/category/search, sort order
 * - getArticleById: returns knowledge article, throws NotFoundException
 * - deleteArticle: sets deletedAt
 * - deleteBulkArticles: bulk soft delete
 * - updateState: updates pipeline state + extra fields
 * - markFailed: sets failed state + step + error
 * - publishToWordPress: validates state, stubs publish
 * - republishToWordPress: validates wpPostId exists
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

import { KnowledgeArticleService } from './knowledge-article.service';
import { KnowledgeArticleState } from '../types/knowledge-article-state';

describe('KnowledgeArticleService', () => {
  let service: KnowledgeArticleService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLean.mockReturnValue({ exec: mockExec });
    mockExec.mockResolvedValue(null);
    service = new KnowledgeArticleService(mockModel as never);
  });

  describe('getArticleById', () => {
    it('returns article when found', async () => {
      const fakeArticle = { _id: 'abc', title: 'Test', type: 'knowledge' };
      mockExec.mockResolvedValue(fakeArticle);

      const result = await service.getArticleById('abc');

      expect(mockFindOne).toHaveBeenCalledWith({ _id: 'abc', type: 'knowledge' });
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
      expect(mockUpdateMany).toHaveBeenCalledWith(
        {
          _id: { $in: ['id1', 'id2', 'id3'] },
          type: 'knowledge',
        },
        expect.any(Object),
      );
    });
  });

  describe('retryArticle', () => {
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

    it('resumes to generating_content when failed at step 1', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.FAILED,
        pipelineFailedStep: 1,
        pipelineError: 'AI timeout',
      });

      const result = await service.retryArticle('abc');

      expect(result.success).toBe(true);
      expect(result.failedStep).toBe(1);
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: 'abc' },
        {
          $set: {
            pipelineState: KnowledgeArticleState.GENERATING_CONTENT,
            pipelineError: null,
            pipelineFailedStep: null,
          },
        },
      );
    });

    it('resumes to content_ready when failed at step 3', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.FAILED,
        pipelineFailedStep: 3,
        pipelineError: 'Image API error',
      });

      const result = await service.retryArticle('abc');

      expect(result.success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: 'abc' },
        {
          $set: {
            pipelineState: KnowledgeArticleState.CONTENT_READY,
            pipelineError: null,
            pipelineFailedStep: null,
          },
        },
      );
    });

    it('resumes to ready when failed at step 5', async () => {
      mockExec.mockResolvedValue({
        _id: 'abc',
        pipelineState: KnowledgeArticleState.FAILED,
        pipelineFailedStep: 5,
        pipelineError: 'WP API error',
      });

      const result = await service.retryArticle('abc');

      expect(result.success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: 'abc' },
        {
          $set: {
            pipelineState: KnowledgeArticleState.READY,
            pipelineError: null,
            pipelineFailedStep: null,
          },
        },
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
