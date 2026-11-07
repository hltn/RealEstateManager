import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { FeatureFlag } from '../../../shared/feature-flags/feature-flag.service';
import { PushSweepService } from './push-sweep.service';

const NOW = new Date('2026-01-01T12:00:00Z');
const MIN = 60 * 1000;

const build = (
  options: { isFlagOn?: boolean; isProviderOn?: boolean } = {},
) => {
  const { isFlagOn = true, isProviderOn = true } = options;
  const exec = jest.fn();
  const query = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec,
  };
  const model = {
    find: jest.fn(() => query),
    updateMany: jest.fn<{ exec: jest.Mock }, unknown[]>(() => ({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
    })),
  };
  const flags = { isEnabled: jest.fn(() => isFlagOn) };
  const provider = { isEnabled: jest.fn(() => isProviderOn) };
  const queue = {
    add: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({}),
    // Mặc định chưa có job cũ trong Redis.
    getJob: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(null),
  };
  const service = new PushSweepService(
    model as never,
    flags as never,
    provider as never,
    queue as never,
  );
  return { service, model, query, exec, flags, queue };
};

/** Job BullMQ giả có trạng thái và `remove`. */
const fakeJob = (state: string) => ({
  getState: jest.fn().mockResolvedValue(state),
  remove: jest.fn().mockResolvedValue(undefined),
});

const doc = (type: string, ageMs: number) => ({
  _id: new Types.ObjectId(),
  type,
  createdAt: new Date(NOW.getTime() - ageMs),
});

describe('PushSweepService (T-32)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('truy vấn PENDING quá 30 giây, cũ nhất trước, tối đa 200', async () => {
    const { service, model, query, exec } = build();
    exec.mockResolvedValue([]);
    await service.run(NOW);
    expect(model.find).toHaveBeenCalledWith({
      pushStatus: 'PENDING',
      createdAt: { $lt: new Date(NOW.getTime() - 30 * 1000) },
    });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(query.limit).toHaveBeenCalledWith(200);
  });

  it('xếp lại bằng jobId push-{id}, không tạo job cho bản quá TTL', async () => {
    const { service, model, exec, queue } = build();
    const live = doc('APPOINTMENT_DUE', 10 * MIN);
    const expired = doc('APPOINTMENT_DUE', 61 * MIN);
    exec.mockResolvedValue([expired, live]);

    const result = await service.run(NOW);

    expect(result).toEqual({ enqueued: 1, skipped: 2 });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'push',
      'push.send',
      { notificationId: String(live._id) },
      { jobId: `push-${String(live._id)}` },
    );
    // SKIPPED có điều kiện PENDING và chỉ cho bản quá hạn.
    expect(model.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [expired._id] }, pushStatus: 'PENDING' },
      { $set: { pushStatus: 'SKIPPED' } },
    );
  });

  it('biên TTL: đúng bằng ttlSeconds còn hạn, quá 1ms thì SKIPPED', async () => {
    const { service, exec, queue, model } = build();
    const edge = doc('APPOINTMENT_DUE', 60 * MIN);
    const over = doc('APPOINTMENT_DUE', 60 * MIN + 1);
    exec.mockResolvedValue([edge, over]);
    await service.run(NOW);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2]).toEqual({
      notificationId: String(edge._id),
    });
    expect(model.updateMany.mock.calls[0][0]).toMatchObject({
      _id: { $in: [over._id] },
    });
  });

  it('loại ngoài danh mục dùng TTL mặc định 24 giờ', async () => {
    const { service, exec, queue } = build();
    exec.mockResolvedValue([
      doc('LOAI_LA', 23 * 60 * MIN),
      doc('LOAI_LA', 25 * 60 * MIN),
    ]);
    const result = await service.run(NOW);
    expect(result.enqueued).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('không có bản quá hạn thì không gọi updateMany', async () => {
    const { service, exec, model } = build();
    exec.mockResolvedValue([doc('APPOINTMENT_DUE', 5 * MIN)]);
    await service.run(NOW);
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('Redis lỗi: dừng lượt (không thử tiếp), không ném', async () => {
    const { service, exec, queue } = build();
    exec.mockResolvedValue([
      doc('APPOINTMENT_DUE', 5 * MIN),
      doc('APPOINTMENT_DUE', 6 * MIN),
    ]);
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(service.run(NOW)).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('job cũ failed/completed: xóa rồi xếp lại, đúng thứ tự getJob -> remove -> add', async () => {
    const { service, exec, queue } = build();
    const failed = doc('APPOINTMENT_DUE', 5 * MIN);
    const completed = doc('APPOINTMENT_DUE', 6 * MIN);
    exec.mockResolvedValue([failed, completed]);
    const failedJob = fakeJob('failed');
    const completedJob = fakeJob('completed');
    queue.getJob
      .mockResolvedValueOnce(failedJob)
      .mockResolvedValueOnce(completedJob);
    const order: string[] = [];
    failedJob.remove.mockImplementation(() => {
      order.push('remove');
      return Promise.resolve();
    });
    queue.add.mockImplementation(() => {
      order.push('add');
      return Promise.resolve({});
    });

    const result = await service.run(NOW);

    expect(result.enqueued).toBe(2);
    expect(queue.getJob).toHaveBeenNthCalledWith(
      1,
      'push',
      `push-${String(failed._id)}`,
    );
    expect(failedJob.remove).toHaveBeenCalledTimes(1);
    expect(completedJob.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(order.slice(0, 2)).toEqual(['remove', 'add']);
  });

  it.each(['waiting', 'active', 'delayed'])(
    'job cũ đang %s: giữ nguyên, không remove, không add, không tính enqueued',
    async (state) => {
      const { service, exec, queue } = build();
      const pending = doc('APPOINTMENT_DUE', 5 * MIN);
      const other = doc('APPOINTMENT_DUE', 6 * MIN);
      exec.mockResolvedValue([pending, other]);
      const busy = fakeJob(state);
      queue.getJob.mockResolvedValueOnce(busy).mockResolvedValueOnce(null);

      const result = await service.run(NOW);

      expect(busy.remove).not.toHaveBeenCalled();
      // Chỉ thông báo không có job cũ được xếp; thông báo có job đang chờ/chạy được bỏ qua và lượt vẫn đi tiếp.
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0][2]).toEqual({
        notificationId: String(other._id),
      });
      expect(result.enqueued).toBe(1);
    },
  );

  it('getJob lỗi: dừng lượt, không add, không ném', async () => {
    const { service, exec, queue } = build();
    exec.mockResolvedValue([
      doc('APPOINTMENT_DUE', 5 * MIN),
      doc('APPOINTMENT_DUE', 6 * MIN),
    ]);
    queue.getJob.mockRejectedValue(new Error('redis down'));
    await expect(service.run(NOW)).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
    });
    expect(queue.getJob).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('getState lỗi: cảnh báo, dừng lượt, không add, không remove, không ném', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, exec, queue } = build();
    exec.mockResolvedValue([
      doc('APPOINTMENT_DUE', 5 * MIN),
      doc('APPOINTMENT_DUE', 6 * MIN),
    ]);
    const job = fakeJob('failed');
    job.getState.mockRejectedValue(new Error('redis down'));
    queue.getJob.mockResolvedValue(job);
    await expect(service.run(NOW)).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
    });
    expect(job.getState).toHaveBeenCalledTimes(1);
    expect(job.remove).not.toHaveBeenCalled();
    expect(queue.getJob).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('getState/remove lỗi: dừng lượt, không add, không ném', async () => {
    const { service, exec, queue } = build();
    exec.mockResolvedValue([
      doc('APPOINTMENT_DUE', 5 * MIN),
      doc('APPOINTMENT_DUE', 6 * MIN),
    ]);
    const job = fakeJob('failed');
    job.remove.mockRejectedValue(new Error('redis down'));
    queue.getJob.mockResolvedValue(job);
    await expect(service.run(NOW)).resolves.toEqual({
      enqueued: 0,
      skipped: 0,
    });
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(queue.getJob).toHaveBeenCalledTimes(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([
    ['cờ tắt', { isFlagOn: false }],
    ['provider tắt', { isProviderOn: false }],
  ])(
    '%s: mọi PENDING thành SKIPPED, không truy vấn danh sách, không xếp job',
    async (_name, flagOptions) => {
      const { service, model, queue, flags } = build(flagOptions);
      const result = await service.run(NOW);
      expect(result).toEqual({ enqueued: 0, skipped: 2 });
      expect(model.updateMany).toHaveBeenCalledWith(
        { pushStatus: 'PENDING' },
        { $set: { pushStatus: 'SKIPPED' } },
      );
      expect(model.find).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(flags.isEnabled).toHaveBeenCalledWith(FeatureFlag.CRM_PUSH);
    },
  );
});
