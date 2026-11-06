import { Logger } from '@nestjs/common';
import { PushQueueWorker } from './push-queue-worker.service';

const build = (enabled: boolean) => {
  const runtime = {
    isEnabled: jest.fn(() => enabled),
    registerWorker: jest.fn(),
    upsertSchedulers: jest.fn().mockResolvedValue(undefined),
  };
  const cleanup = { run: jest.fn().mockResolvedValue({}) };
  const worker = new PushQueueWorker(runtime as never, cleanup as never);
  return { worker, runtime, cleanup };
};

describe('PushQueueWorker (T-29)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('QUEUE_WORKERS_ENABLED tắt: không đăng ký worker hay job lặp', () => {
    const { worker, runtime } = build(false);
    worker.onApplicationBootstrap();
    expect(runtime.registerWorker).not.toHaveBeenCalled();
    expect(runtime.upsertSchedulers).not.toHaveBeenCalled();
  });

  it('bật: đăng ký MỘT worker cho queue push (5 song song, 50 job/giây) và job lặp push.cleanup mỗi 6 giờ', () => {
    const { worker, runtime } = build(true);
    worker.onApplicationBootstrap();

    expect(runtime.registerWorker).toHaveBeenCalledTimes(1);
    expect(runtime.registerWorker).toHaveBeenCalledWith(
      'push',
      expect.any(Function),
      { concurrency: 5, limiter: { max: 50, duration: 1000 } },
    );
    expect(runtime.upsertSchedulers).toHaveBeenCalledWith('push', [
      {
        id: 'push-cleanup',
        repeat: { every: 6 * 60 * 60 * 1000 },
        jobName: 'push.cleanup',
        opts: { attempts: 1 },
      },
    ]);
  });

  it('đăng ký job lặp lỗi: chỉ ghi log, không làm sập khởi động', async () => {
    const { worker, runtime } = build(true);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    runtime.upsertSchedulers.mockRejectedValue(new Error('redis down'));

    expect(() => worker.onApplicationBootstrap()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('job push.cleanup gọi dọn dẹp; job lạ (kể cả push.send chưa hỗ trợ) ném lỗi, không nuốt', async () => {
    const { worker, cleanup } = build(true);

    await worker.handle({ name: 'push.cleanup' });
    await expect(worker.handle({ name: 'khac' })).rejects.toThrow('khac');
    await expect(worker.handle({ name: 'push.send' })).rejects.toThrow(
      'push.send',
    );

    expect(cleanup.run).toHaveBeenCalledTimes(1);
  });
});
