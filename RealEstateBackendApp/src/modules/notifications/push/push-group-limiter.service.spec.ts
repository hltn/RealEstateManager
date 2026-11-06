import { Logger } from '@nestjs/common';
import {
  PUSH_GROUP_MAX_PER_USER,
  PUSH_GROUP_TTL_SECONDS,
  PushGroupLimiter,
} from './push-group-limiter.service';

describe('PushGroupLimiter (T-33)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  const build = (evalImpl: jest.Mock = jest.fn().mockResolvedValue(1)) => {
    const redis = { eval: evalImpl };
    return { redis, limiter: new PushGroupLimiter(redis as never) };
  };

  it('hằng số đúng tài liệu: 3 push/người/đợt, hạn 10 phút', () => {
    expect(PUSH_GROUP_MAX_PER_USER).toBe(3);
    expect(PUSH_GROUP_TTL_SECONDS).toBe(600);
  });

  it('không có groupKey (null/undefined/rỗng): cho gửi, không gọi Redis', async () => {
    const { redis, limiter } = build();
    expect(await limiter.tryAcquire('u1', null, 'n1')).toBe(true);
    expect(await limiter.tryAcquire('u1', undefined, 'n1')).toBe(true);
    expect(await limiter.tryAcquire('u1', '', 'n1')).toBe(true);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('khóa bộ đếm push:group:{userId}:{groupKey}, dấu quyết định theo notificationId, giới hạn 3, hạn 600 giây', async () => {
    const { redis, limiter } = build();
    await limiter.tryAcquire('u1', 'BULK:req-1', 'n1');
    const args = redis.eval.mock.calls[0] as unknown[];
    expect(args[0]).toEqual(expect.stringContaining("redis.call('INCR'"));
    expect(args[0]).toEqual(expect.stringContaining("redis.call('EXPIRE'"));
    expect(args.slice(1)).toEqual([
      2,
      'push:group:u1:BULK:req-1',
      'push:group:u1:BULK:req-1:n:n1',
      3,
      600,
    ]);
  });

  it('Redis trả 1 thì cho gửi, 0 thì chặn', async () => {
    const allowed = build(jest.fn().mockResolvedValue(1));
    const denied = build(jest.fn().mockResolvedValue(0));
    expect(await allowed.limiter.tryAcquire('u1', 'BULK:a', 'n1')).toBe(true);
    expect(await denied.limiter.tryAcquire('u1', 'BULK:a', 'n1')).toBe(false);
  });

  it('Redis lỗi: fail-open (cho gửi), chỉ log cảnh báo, không lộ groupKey', async () => {
    const { limiter } = build(
      jest.fn().mockRejectedValue(new Error('Command timed out')),
    );
    await expect(limiter.tryAcquire('u1', 'BULK:req-1', 'n1')).resolves.toBe(
      true,
    );
    const logged = warnSpy.mock.calls.flat().join('\n');
    expect(logged).toContain('notificationId=n1');
    expect(logged).not.toContain('req-1');
  });
});
