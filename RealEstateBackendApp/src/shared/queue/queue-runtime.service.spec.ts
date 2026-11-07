/**
 * FR-03 — cấu hình queue `push` và tùy chọn `limiter` của registerWorker (không phá hành vi cũ).
 */
import { ConfigService } from '@nestjs/config';

const workerCtor = jest.fn();
const queueCtor = jest.fn();
const getJobMock = jest.fn();
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((...args: unknown[]) => {
    workerCtor(...args);
    return { on: jest.fn(), close: jest.fn() };
  }),
  Queue: jest.fn().mockImplementation((...args: unknown[]) => {
    queueCtor(...args);
    return {
      on: jest.fn(),
      add: jest.fn(),
      getJob: getJobMock,
      close: jest.fn(),
    };
  }),
}));

import { QueueRuntimeService } from './queue-runtime.service';
import {
  DEFAULT_JOB_OPTIONS,
  PUSH_JOB_OPTIONS,
  PUSH_WORKER_OPTIONS,
  QueueNames,
} from './queue.constants';

function makeService(): QueueRuntimeService {
  const config = {
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;
  const service = new QueueRuntimeService(config);
  jest.spyOn(service, 'isEnabled').mockReturnValue(true);
  return service;
}

describe('QueueNames / cấu hình queue push (FR-03)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('FR-03: có tên queue push và crm-image, không trùng tên', () => {
    expect(QueueNames.PUSH).toBe('push');
    expect(QueueNames.CRM_IMAGE).toBe('crm-image');
    const values = Object.values(QueueNames);
    expect(new Set(values).size).toBe(values.length);
  });

  it('FR-03: job push retry 5 lần, backoff mũ 5000ms jitter 0.5; job mặc định vẫn 3 lần', () => {
    expect(PUSH_JOB_OPTIONS.attempts).toBe(5);
    expect(PUSH_JOB_OPTIONS.backoff).toEqual({
      type: 'exponential',
      delay: 5000,
      jitter: 0.5,
    });
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBe(1000);
  });

  it('FR-03: worker push dùng concurrency 5 và limiter 50 job/giây', () => {
    expect(PUSH_WORKER_OPTIONS).toEqual({
      concurrency: 5,
      limiter: { max: 50, duration: 1000 },
    });
  });

  it('FR-03: registerWorker không truyền limiter thì worker không có limiter (hành vi cũ)', () => {
    makeService().registerWorker('x', jest.fn());
    const opts = workerCtor.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.concurrency).toBe(1);
    expect('limiter' in opts).toBe(false);
  });

  it('FR-03: registerWorker truyền limiter thì chuyển nguyên cho BullMQ Worker', () => {
    makeService().registerWorker(
      QueueNames.PUSH,
      jest.fn(),
      PUSH_WORKER_OPTIONS,
    );
    const opts = workerCtor.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.concurrency).toBe(5);
    expect(opts.limiter).toEqual({ max: 50, duration: 1000 });
  });

  it('FR-03: queue push tạo với job options push, queue khác dùng mặc định', async () => {
    const service = makeService();
    await service.add(QueueNames.PUSH, 'push.send', {}, { jobId: 'push:1' });
    await service.add(QueueNames.CRM_SCHEDULER, 'tick', {}, { jobId: 't:1' });
    const byName = new Map(
      queueCtor.mock.calls.map(([name, o]) => [
        name as string,
        (o as { defaultJobOptions: unknown }).defaultJobOptions,
      ]),
    );
    expect(byName.get('push')).toBe(PUSH_JOB_OPTIONS);
    expect(byName.get('crm-scheduler')).toBe(DEFAULT_JOB_OPTIONS);
  });

  it('getJob: runtime tắt thì trả null và không mở kết nối queue', async () => {
    const service = makeService();
    jest.spyOn(service, 'isEnabled').mockReturnValue(false);
    await expect(service.getJob(QueueNames.PUSH, 'push-1')).resolves.toBeNull();
    expect(queueCtor).not.toHaveBeenCalled();
  });

  it('getJob: trả job của queue, hoặc null khi không có', async () => {
    const service = makeService();
    const job = { id: 'push-1' };
    getJobMock.mockResolvedValueOnce(job).mockResolvedValueOnce(undefined);
    await expect(service.getJob(QueueNames.PUSH, 'push-1')).resolves.toBe(job);
    expect(getJobMock).toHaveBeenCalledWith('push-1');
    await expect(service.getJob(QueueNames.PUSH, 'push-2')).resolves.toBeNull();
  });
});
