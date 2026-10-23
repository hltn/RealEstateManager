import { ConfigService } from '@nestjs/config';
import {
  buildBullPrefix,
  buildRedisOptions,
  getKeyPrefix,
} from './redis.config';

const build = (url?: string) =>
  buildRedisOptions({ get: () => url } as unknown as ConfigService);

describe('buildRedisOptions', () => {
  it('không cấu hình thì dùng Redis cục bộ mặc định', () => {
    expect(build(undefined)).toMatchObject({
      host: '127.0.0.1',
      port: 6379,
      db: 0,
    });
  });

  it('đọc host, port, database từ URL', () => {
    expect(build('redis://cache.internal:6380/2')).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      db: 2,
    });
  });

  it('đọc user/mật khẩu (có ký tự đặc biệt được mã hóa %) và không bật TLS với redis://', () => {
    const options = build('redis://app:p%40ss%3Aword@cache:6379');

    expect(options).toMatchObject({ username: 'app', password: 'p@ss:word' });
    expect(options.tls).toBeUndefined();
  });

  it('rediss:// bật TLS', () => {
    expect(build('rediss://cache:6379').tls).toBeDefined();
  });

  it.each(['not a url', 'http://cache:6379', 'redis://cache:6379/abc'])(
    'URL không hợp lệ (%p) thì ném lỗi rõ ràng để app không khởi động',
    (url) => {
      expect(() => build(url)).toThrow(/REDIS_URL/);
    },
  );
});

describe('prefix key Redis / BullMQ', () => {
  const configWith = (prefix?: string) =>
    ({ get: () => prefix }) as unknown as ConfigService;

  it('mặc định rem: và BullMQ dùng rem:bull (không còn hardcode "bull")', () => {
    expect(getKeyPrefix(configWith(undefined))).toBe('rem:');
    expect(buildBullPrefix(configWith(undefined))).toBe('rem:bull');
  });

  it('prefix bắt nguồn từ REDIS_KEY_PREFIX, bỏ dấu : thừa ở cuối để BullMQ không sinh "::"', () => {
    expect(buildBullPrefix(configWith('staging-1:'))).toBe('staging-1:bull');
    expect(buildBullPrefix(configWith('staging-1'))).toBe('staging-1:bull');
    expect(buildBullPrefix(configWith('a::'))).toBe('a:bull');
  });
});
