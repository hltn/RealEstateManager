import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AnalyzeJobService } from './analyze-job.service';

/**
 * Unit test cho AnalyzeJobService — in-memory job tracking, có TTL cleanup.
 */
describe('AnalyzeJobService', () => {
  let service: AnalyzeJobService;

  let seq = 0;
  const mockRandomUUID = () => `uuid-${++seq}`;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Mock randomUUID để có giá trị deterministic, mỗi lần tăng dần
    jest.spyOn(require('crypto'), 'randomUUID').mockImplementation(mockRandomUUID);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyzeJobService],
    }).compile();

    service = module.get<AnalyzeJobService>(AnalyzeJobService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createJob', () => {
    it('should create a job with status pending and return its id', () => {
      const jobId = service.createJob();

      expect(jobId).toBe('uuid-1');
      const job = service.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe('pending');
      expect(job?.updatedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should clean up expired jobs when creating a new one', () => {
      // Tạo 1 job, rồi mock Date.now +61 phút để job cũ hết hạn
      const oldId = service.createJob();
      expect(service.getJob(oldId)).toBeDefined();

      const nowMs = Date.now();
      const dateSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(nowMs + 61 * 60 * 1000);

      service.createJob(); // trigger cleanupExpiredJobs

      expect(service.getJob(oldId)).toBeUndefined();
      dateSpy.mockRestore();
    });
  });

  describe('getJob', () => {
    it('should return undefined for unknown jobId', () => {
      expect(service.getJob('does-not-exist')).toBeUndefined();
    });
  });

  describe('markDone', () => {
    it('should set status done with result and timestamp', () => {
      const jobId = service.createJob();
      const result = [{ id: 1 }];

      service.markDone(jobId, result);

      const job = service.getJob(jobId);
      expect(job?.status).toBe('done');
      expect(job?.result).toEqual(result);
    });
  });

  describe('markError', () => {
    it('should set status error with error message', () => {
      const jobId = service.createJob();

      service.markError(jobId, 'something failed');

      const job = service.getJob(jobId);
      expect(job?.status).toBe('error');
      expect(job?.error).toBe('something failed');
    });
  });
});
