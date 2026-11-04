/**
 * IdempotencyService (Redis) — unit spec.
 *
 * Dùng một Redis giả trong bộ nhớ mô phỏng đúng ngữ nghĩa các lệnh service dùng
 * (GET, SET ... PX [NX], EXISTS, DEL, hết hạn theo thời gian). Hành vi thật trên Redis
 * được kiểm ở `shared/foundation.integration.spec.ts` và
 * `modules/news-fire-crawl-manager/news-fire-crawl-manager.lock.integration.spec.ts` (cần Redis chạy).
 */
import type Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService, buildIdempotencyKey } from './idempotency.service';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/** Redis giả tối thiểu: lưu value + thời điểm hết hạn, hỗ trợ `NX` và `PX`. */
class FakeRedis {
  readonly store = new Map<string, { value: string; expiresAt: number }>();
  readonly setCalls: unknown[][] = [];

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  get = jest.fn((key: string) =>
    Promise.resolve(this.live(key)?.value ?? null),
  );

  set = jest.fn(
    (key: string, value: string, px: string, ttl: number, nx?: string) => {
      this.setCalls.push([key, value, px, ttl, nx]);
      if (nx === 'NX' && this.live(key)) return Promise.resolve(null);
      this.store.set(key, { value, expiresAt: Date.now() + ttl });
      return Promise.resolve('OK');
    },
  );

  exists = jest.fn((key: string) => Promise.resolve(this.live(key) ? 1 : 0));

  /** Mô phỏng script compare-and-delete: chỉ xóa khi giá trị khớp ARGV[1]. */
  eval = jest.fn(
    (_script: string, _numKeys: number, key: string, expected: string) => {
      if (this.live(key)?.value !== expected) return Promise.resolve(0);
      this.store.delete(key);
      return Promise.resolve(1);
    },
  );

  del = jest.fn((key: string) =>
    Promise.resolve(this.store.delete(key) ? 1 : 0),
  );
}

function createService(
  env: Record<string, string> = {},
  redis: FakeRedis = new FakeRedis(),
) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const service = new IdempotencyService(redis as unknown as Redis, config);
  return { service, redis };
}

describe('IdempotencyService (Redis)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('get / set', () => {
    it('chưa set thì get trả null', async () => {
      const { service } = createService();
      await expect(service.get('k')).resolves.toBeNull();
    });

    it('set rồi get trả lại đúng response (round-trip qua JSON)', async () => {
      const { service } = createService();
      const payload = { message: 'ok', data: { id: 1, tags: ['a', 'b'] } };

      await service.set('k', payload);

      await expect(service.get<typeof payload>('k')).resolves.toEqual(payload);
    });

    it('set(undefined) vẫn lưu được và get trả null (không ném lỗi parse)', async () => {
      const { service } = createService();
      await service.set('k', undefined);
      await expect(service.get('k')).resolves.toBeNull();
    });

    it('hết TTL mặc định 5 phút thì get trả null; ngay trước đó vẫn còn', async () => {
      const { service } = createService();
      await service.set('k', { v: 1 });

      jest.advanceTimersByTime(FIVE_MINUTES_MS - 1);
      await expect(service.get('k')).resolves.toEqual({ v: 1 });

      jest.advanceTimersByTime(1);
      await expect(service.get('k')).resolves.toBeNull();
    });

    it('IDEMPOTENCY_TTL_MS cấu hình được và được truyền cho Redis dạng PX', async () => {
      const { service, redis } = createService({ IDEMPOTENCY_TTL_MS: '1000' });

      await service.set('k', { v: 1 });

      expect(redis.setCalls[0]).toEqual([
        'idem:resp:k',
        '{"v":1}',
        'PX',
        1000,
        undefined,
      ]);
      jest.advanceTimersByTime(1000);
      await expect(service.get('k')).resolves.toBeNull();
    });

    it.each(['abc', '0', '-5', '1.5', ''])(
      'IDEMPOTENCY_TTL_MS không hợp lệ (%p) thì dùng mặc định 5 phút',
      async (invalid) => {
        const { service, redis } = createService({
          IDEMPOTENCY_TTL_MS: invalid,
        });
        await service.set('k', {});
        expect(redis.setCalls[0][3]).toBe(FIVE_MINUTES_MS);
      },
    );
  });

  describe('khóa đang xử lý (in-flight)', () => {
    it('mặc định không in-flight; markInFlight rồi isInFlight true; clearInFlight rồi false', async () => {
      const { service } = createService();
      await expect(service.isInFlight('k')).resolves.toBe(false);

      await service.markInFlight('k');
      await expect(service.isInFlight('k')).resolves.toBe(true);

      await service.clearInFlight('k');
      await expect(service.isInFlight('k')).resolves.toBe(false);
    });

    it('clearInFlight cho key chưa tồn tại không ném lỗi', async () => {
      const { service } = createService();
      await expect(service.clearInFlight('none')).resolves.toBeUndefined();
    });

    it('khóa tự hết hạn sau IDEMPOTENCY_INFLIGHT_TTL_MS (mặc định 30 phút) để instance chết không khóa vĩnh viễn', async () => {
      const { service } = createService();
      await service.markInFlight('k');

      jest.advanceTimersByTime(THIRTY_MINUTES_MS - 1);
      await expect(service.isInFlight('k')).resolves.toBe(true);

      jest.advanceTimersByTime(1);
      await expect(service.isInFlight('k')).resolves.toBe(false);
    });

    it('tryMarkInFlight: lần đầu giành được khóa (true), lần hai khi đang giữ thì false', async () => {
      const { service } = createService();

      await expect(service.tryMarkInFlight('k')).resolves.toBe(true);
      await expect(service.tryMarkInFlight('k')).resolves.toBe(false);

      await service.clearInFlight('k');
      await expect(service.tryMarkInFlight('k')).resolves.toBe(true);
    });

    it('tryMarkInFlight gửi cờ NX + PX tới Redis (nguyên tử, không có khe race check-then-set)', async () => {
      const { service, redis } = createService();
      await service.tryMarkInFlight('k');
      expect(redis.setCalls[0]).toEqual([
        'idem:lock:k',
        expect.any(String),
        'PX',
        THIRTY_MINUTES_MS,
        'NX',
      ]);
    });
  });

  describe('khóa gắn với instance (bootId) và TTL riêng', () => {
    it('clearInFlight KHÔNG xóa khóa đã thuộc về instance khác (khóa cũ hết hạn, instance khác giành lại)', async () => {
      const redis = new FakeRedis();
      const podA = createService({}, redis).service;
      const podB = createService({}, redis).service;
      await podA.tryMarkInFlight('k');

      await podB.clearInFlight('k');

      await expect(podA.isInFlight('k')).resolves.toBe(true);
      await podA.clearInFlight('k');
      await expect(podA.isInFlight('k')).resolves.toBe(false);
    });

    it('TTL riêng theo từng khóa ghi đè mặc định, giá trị sai thì dùng mặc định', async () => {
      const { service, redis } = createService();

      await service.tryMarkInFlight('short', { ttlMs: 1000 });
      await service.tryMarkInFlight('bad', { ttlMs: -1 });

      expect(redis.setCalls[0][3]).toBe(1000);
      expect(redis.setCalls[1][3]).toBe(THIRTY_MINUTES_MS);
      jest.advanceTimersByTime(1000);
      await expect(service.isInFlight('short')).resolves.toBe(false);
      await expect(service.isInFlight('bad')).resolves.toBe(true);
    });

    it('tắt êm: nhả các khóa instance này đang giữ, không đụng khóa của instance khác', async () => {
      const redis = new FakeRedis();
      const podA = createService({}, redis).service;
      const podB = createService({}, redis).service;
      await podA.tryMarkInFlight('a-job');
      await podB.tryMarkInFlight('b-job');

      await podA.beforeApplicationShutdown();

      await expect(podA.isInFlight('a-job')).resolves.toBe(false);
      await expect(podA.isInFlight('b-job')).resolves.toBe(true);
    });

    it('tắt êm khi Redis lỗi không ném lỗi (chỉ cảnh báo, khóa tự hết hạn theo TTL)', async () => {
      const { service, redis } = createService();
      await service.tryMarkInFlight('k');
      redis.eval.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        service.beforeApplicationShutdown(),
      ).resolves.toBeUndefined();
    });
  });

  describe('buildIdempotencyKey (phạm vi theo người dùng + route)', () => {
    const scope = { userId: 'user-a', route: 'POST /crm/customers' };

    it('cùng người dùng + route + key thì cho cùng khóa (để retry khớp được response cũ)', () => {
      expect(buildIdempotencyKey(scope, 'abc')).toBe(
        buildIdempotencyKey({ ...scope }, 'abc'),
      );
    });

    it('khác người dùng hoặc khác route cùng X-Idempotency-Key thì KHÁC khóa (không đọc nhầm response của người khác)', () => {
      const base = buildIdempotencyKey(scope, 'abc');

      expect(
        buildIdempotencyKey({ ...scope, userId: 'user-b' }, 'abc'),
      ).not.toBe(base);
      expect(
        buildIdempotencyKey({ ...scope, route: 'POST /crm/notes' }, 'abc'),
      ).not.toBe(base);
    });

    it('ranh giới trường không nhập nhằng: ("a:b","c") khác ("a","b:c")', () => {
      expect(buildIdempotencyKey({ userId: 'a:b', route: 'r' }, 'c')).not.toBe(
        buildIdempotencyKey({ userId: 'a', route: 'b:r' }, 'c'),
      );
    });
  });

  it('response đã lưu và khóa in-flight cùng key không đè nhau (khác namespace)', async () => {
    const { service } = createService();

    await service.markInFlight('same');
    await expect(service.get('same')).resolves.toBeNull();

    await service.set('same', { done: true });
    await service.clearInFlight('same');
    await expect(service.get('same')).resolves.toEqual({ done: true });
  });

  it('lỗi Redis được ném lên (không nuốt, không âm thầm cho qua)', async () => {
    const { service, redis } = createService();
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.get('k')).rejects.toThrow('ECONNREFUSED');
  });
});
