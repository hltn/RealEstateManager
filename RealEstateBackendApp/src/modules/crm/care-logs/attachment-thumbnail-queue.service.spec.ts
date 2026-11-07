import { Logger } from '@nestjs/common';
import { AttachmentThumbnailQueueService } from './attachment-thumbnail-queue.service';

const build = (enabled = true) => {
  const runtime = {
    isEnabled: jest.fn(() => enabled),
    registerWorker: jest.fn(),
    add: jest.fn().mockResolvedValue({ id: 'job' }),
    getJob: jest.fn().mockResolvedValue(null),
  };
  const processor = { process: jest.fn().mockResolvedValue('CREATED') };
  const service = new AttachmentThumbnailQueueService(
    runtime as never,
    processor as never,
  );
  return { service, runtime, processor };
};

describe('AttachmentThumbnailQueueService (FR-26)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('FR-26: QUEUE_WORKERS_ENABLED tắt => không đăng ký worker', () => {
    const { service, runtime } = build(false);

    service.onApplicationBootstrap();

    expect(runtime.registerWorker).not.toHaveBeenCalled();
  });

  it('FR-26: bật => MỘT worker cho queue crm-image với concurrency 2', () => {
    const { service, runtime } = build(true);

    service.onApplicationBootstrap();

    expect(runtime.registerWorker).toHaveBeenCalledTimes(1);
    expect(runtime.registerWorker).toHaveBeenCalledWith(
      'crm-image',
      expect.any(Function),
      { concurrency: 2 },
    );
  });

  it('FR-26: enqueue xếp job attachment.thumbnail với jobId thumb-{id} (không dấu hai chấm, BullMQ cấm)', async () => {
    const { service, runtime } = build();

    expect(await service.enqueue('abc123')).toBe(true);

    expect(runtime.add).toHaveBeenCalledWith(
      'crm-image',
      'attachment.thumbnail',
      { attachmentId: 'abc123' },
      { jobId: 'thumb-abc123' },
    );
    expect('thumb-abc123').not.toContain(':');
  });

  describe('job cũ còn trong Redis (BullMQ bỏ qua add khi jobId còn)', () => {
    const oldJob = (state: string) => ({
      getState: jest.fn().mockResolvedValue(state),
      remove: jest.fn().mockResolvedValue(undefined),
    });

    it.each(['completed', 'failed'])(
      'FR-26: job %s còn giữ => xóa rồi mới add, trả true',
      async (state) => {
        const { service, runtime } = build();
        const job = oldJob(state);
        runtime.getJob.mockResolvedValue(job);
        const order: string[] = [];
        job.remove.mockImplementation(() => {
          order.push('remove');
          return Promise.resolve();
        });
        runtime.add.mockImplementation(() => {
          order.push('add');
          return Promise.resolve({ id: 'job' });
        });

        expect(await service.enqueue('abc123')).toBe(true);

        expect(runtime.getJob).toHaveBeenCalledWith(
          'crm-image',
          'thumb-abc123',
        );
        expect(order).toEqual(['remove', 'add']);
      },
    );

    it.each(['waiting', 'active', 'delayed', 'prioritized'])(
      'FR-26: job đang %s => KHÔNG xóa, KHÔNG add, trả false (không đếm là đã xếp)',
      async (state) => {
        const { service, runtime } = build();
        const job = oldJob(state);
        runtime.getJob.mockResolvedValue(job);

        expect(await service.enqueue('abc123')).toBe(false);

        expect(job.remove).not.toHaveBeenCalled();
        expect(runtime.add).not.toHaveBeenCalled();
      },
    );

    it('FR-26: xóa job cũ lỗi (Redis lỗi/job bị khóa) => trả false, không add, không ném', async () => {
      const { service, runtime } = build();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const job = oldJob('failed');
      job.remove.mockRejectedValue(new Error('locked'));
      runtime.getJob.mockResolvedValue(job);

      await expect(service.enqueue('abc123')).resolves.toBe(false);

      expect(runtime.add).not.toHaveBeenCalled();
    });

    it('FR-26: getJob lỗi (Redis down) => trả false, không ném', async () => {
      const { service, runtime } = build();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      runtime.getJob.mockRejectedValue(new Error('redis down'));

      await expect(service.enqueue('abc123')).resolves.toBe(false);
    });
  });

  it('FR-26: runtime tắt (add trả null) => enqueue trả false, không lỗi', async () => {
    const { service, runtime } = build(false);
    runtime.add.mockResolvedValue(null);

    expect(await service.enqueue('abc123')).toBe(false);
  });

  it('FR-26: lỗi xếp hàng (Redis down) chỉ ghi log, không ném (upload không bị hỏng)', async () => {
    const { service, runtime } = build();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    runtime.add.mockRejectedValue(new Error('redis down'));

    await expect(service.enqueue('abc123')).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('FR-26: handle giao job attachment.thumbnail cho processor kèm attemptsMade và opts', async () => {
    const { service, processor } = build();

    await service.handle({
      name: 'attachment.thumbnail',
      data: { attachmentId: 'abc123' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    });

    expect(processor.process).toHaveBeenCalledWith({
      data: { attachmentId: 'abc123' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    });
  });

  it('FR-26: handle job lạ ném lỗi (không nuốt), không gọi processor; lỗi của processor nổi lên', async () => {
    const { service, processor } = build();

    await expect(service.handle({ name: 'khac' })).rejects.toThrow('khac');
    expect(processor.process).not.toHaveBeenCalled();

    processor.process.mockRejectedValue(new Error('hỏng'));
    await expect(
      service.handle({ name: 'attachment.thumbnail' }),
    ).rejects.toThrow('hỏng');
    expect(processor.process).toHaveBeenCalledWith({
      data: {},
      attemptsMade: 0,
      opts: undefined,
    });
  });
});
