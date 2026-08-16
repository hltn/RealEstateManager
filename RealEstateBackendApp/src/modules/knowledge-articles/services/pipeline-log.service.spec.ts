/**
 * PipelineLogService unit tests.
 *
 * Mocks the Mongoose Model and tests:
 * - createLog: creates a pipeline run log
 * - addArticleResult: appends article result, increments counters
 * - updateStep: updates step status and timestamps
 * - updateTotalDuration: sets total duration
 * - finalizeLog: marks pipeline as completed/failed
 * - listLogs: paginated list with filters
 * - getLogByBatchId: returns log or null
 */

const mockExec = jest.fn();
const mockFind = jest.fn(() => ({
  sort: jest.fn(() => ({
    skip: jest.fn(() => ({
      limit: jest.fn(() => ({
        lean: jest.fn(() => ({ exec: mockExec })),
      })),
    })),
  })),
}));
const mockFindOne = jest.fn(() => ({
  lean: jest.fn(() => ({ exec: mockExec })),
}));
const mockUpdateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }));
const mockCreate = jest.fn();
const mockCountDocuments = jest.fn(() => ({
  exec: jest.fn().mockResolvedValue(0),
}));

const mockLogModel = {
  find: mockFind,
  findOne: mockFindOne,
  updateOne: mockUpdateOne,
  create: mockCreate,
  countDocuments: mockCountDocuments,
};

import { PipelineLogService } from './pipeline-log.service';
import { PipelineRunStatus } from '../schemas/pipeline-log.schema';

describe('PipelineLogService', () => {
  let service: PipelineLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PipelineLogService(mockLogModel as never);
  });

  describe('createLog', () => {
    it('creates a new log with running status', async () => {
      const created = {
        batchId: 'batch-1',
        categorySlug: 'ha-noi',
        source: 'manual',
        status: PipelineRunStatus.RUNNING,
      };
      mockCreate.mockResolvedValue(created);

      const result = await service.createLog({
        batchId: 'batch-1',
        categorySlug: 'ha-noi',
        source: 'manual',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        batchId: 'batch-1',
        categorySlug: 'ha-noi',
        source: 'manual',
        status: PipelineRunStatus.RUNNING,
      });
      expect(result).toEqual(created);
    });
  });

  describe('addArticleResult', () => {
    it('pushes result and increments counters', async () => {
      await service.addArticleResult('batch-1', {
        articleId: 'art-1' as never,
        title: 'Test Article',
        state: 'published',
        wpPostId: 123,
        duration: 5000,
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        expect.objectContaining({
          $push: {
            articleResults: expect.objectContaining({
              title: 'Test Article',
              state: 'published',
              wpPostId: 123,
            }),
          },
          $inc: expect.objectContaining({
            totalArticles: 1,
            publishedCount: 1,
          }),
        }),
      );
    });

    it('increments failedCount for failed articles', async () => {
      await service.addArticleResult('batch-1', {
        articleId: 'art-2' as never,
        title: 'Failed Article',
        state: 'failed',
        error: 'AI timeout',
        failedStep: 2,
        duration: 3000,
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        expect.objectContaining({
          $inc: expect.objectContaining({
            totalArticles: 1,
            failedCount: 1,
          }),
        }),
      );
    });

    it('increments readyCount for ready articles', async () => {
      await service.addArticleResult('batch-1', {
        articleId: 'art-3' as never,
        title: 'Ready Article',
        state: 'ready',
        duration: 4000,
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        expect.objectContaining({
          $inc: expect.objectContaining({
            totalArticles: 1,
            readyCount: 1,
          }),
        }),
      );
    });
  });

  describe('updateStep', () => {
    it('sets step status to running with startedAt', async () => {
      await service.updateStep('batch-1', 2, {
        status: 'running',
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1', 'steps.step': 2 },
        expect.objectContaining({
          $set: expect.objectContaining({
            'steps.$.status': 'running',
            'steps.$.startedAt': expect.any(String),
          }),
        }),
      );
    });

    it('sets step status to done with completedAt', async () => {
      await service.updateStep('batch-1', 1, {
        status: 'done',
        result: { articleCount: 3 },
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1', 'steps.step': 1 },
        expect.objectContaining({
          $set: expect.objectContaining({
            'steps.$.status': 'done',
            'steps.$.result': { articleCount: 3 },
            'steps.$.completedAt': expect.any(String),
          }),
        }),
      );
    });

    it('sets step error', async () => {
      await service.updateStep('batch-1', 3, {
        status: 'error',
        error: 'Image API timeout',
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1', 'steps.step': 3 },
        expect.objectContaining({
          $set: expect.objectContaining({
            'steps.$.status': 'error',
            'steps.$.error': 'Image API timeout',
          }),
        }),
      );
    });
  });

  describe('updateTotalDuration', () => {
    it('updates total duration for a pipeline run', async () => {
      await service.updateTotalDuration('batch-1', 45000);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        { $set: { totalDuration: 45000 } },
      );
    });
  });

  describe('finalizeLog', () => {
    it('marks pipeline as completed', async () => {
      await service.finalizeLog('batch-1', PipelineRunStatus.COMPLETED, {
        publishedCount: 3,
        failedCount: 0,
        readyCount: 0,
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        {
          $set: {
            status: PipelineRunStatus.COMPLETED,
            publishedCount: 3,
            failedCount: 0,
            readyCount: 0,
          },
        },
      );
    });

    it('marks pipeline as failed with error summary', async () => {
      await service.finalizeLog('batch-1', PipelineRunStatus.FAILED, {
        publishedCount: 0,
        failedCount: 2,
        readyCount: 1,
        errorSummary: 'WP API connection failed',
      });

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        {
          $set: {
            status: PipelineRunStatus.FAILED,
            publishedCount: 0,
            failedCount: 2,
            readyCount: 1,
            errorSummary: 'WP API connection failed',
          },
        },
      );
    });

    it('marks pipeline without summary', async () => {
      await service.finalizeLog('batch-1', PipelineRunStatus.COMPLETED);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { batchId: 'batch-1' },
        { $set: { status: PipelineRunStatus.COMPLETED } },
      );
    });
  });

  describe('listLogs', () => {
    it('returns paginated results with default params', async () => {
      const logs = [{ batchId: 'b1' }, { batchId: 'b2' }];
      const mockLean = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(logs) });
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockCountDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      });

      const result = await service.listLogs({ page: 1, limit: 20 });

      expect(result.data).toEqual(logs);
      expect(result.meta.total).toBe(5);
      expect(result.meta.page).toBe(1);
    });

    it('filters by status', async () => {
      const mockLean = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.listLogs({ page: 1, limit: 20, status: 'completed' });

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('filters by category', async () => {
      const mockLean = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      const mockLimit = jest.fn().mockReturnValue({ lean: mockLean });
      const mockSkip = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockSort = jest.fn().mockReturnValue({ skip: mockSkip });
      mockFind.mockReturnValue({ sort: mockSort });
      mockCountDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.listLogs({ page: 1, limit: 20, category: 'hcm' });

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({ categorySlug: 'hcm' }),
      );
    });
  });

  describe('getLogByBatchId', () => {
    it('returns log when found', async () => {
      const log = { batchId: 'b1', status: 'completed' };
      mockExec.mockResolvedValue(log);

      const result = await service.getLogByBatchId('b1');

      expect(mockFindOne).toHaveBeenCalledWith({ batchId: 'b1' });
      expect(result).toEqual(log);
    });

    it('returns null when not found', async () => {
      mockExec.mockResolvedValue(null);

      const result = await service.getLogByBatchId('missing');

      expect(result).toBeNull();
    });
  });
});
