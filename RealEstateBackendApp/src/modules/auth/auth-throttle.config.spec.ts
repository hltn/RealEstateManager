import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AUTH_LOGIN_THROTTLE_ENV,
  AUTH_LOGIN_THROTTLE_TTL_MS,
  reportAuthLoginThrottleStartup,
  resolveAuthLoginThrottleLimit,
} from './auth-throttle.config';

describe('resolveAuthLoginThrottleLimit', () => {
  it('mặc định giữ 5 khi chưa đặt, rỗng hoặc toàn khoảng trắng', () => {
    expect(resolveAuthLoginThrottleLimit(undefined, 'development')).toBe(5);
    expect(resolveAuthLoginThrottleLimit('', 'development')).toBe(5);
    expect(resolveAuthLoginThrottleLimit('  ', 'development')).toBe(5);
  });

  it('production luôn dùng 5, bỏ qua biến kể cả giá trị hợp lệ lớn hoặc sai định dạng', () => {
    expect(resolveAuthLoginThrottleLimit('1000', 'production')).toBe(5);
    expect(resolveAuthLoginThrottleLimit('10000', 'production')).toBe(5);
    expect(resolveAuthLoginThrottleLimit('abc', 'production')).toBe(5);
  });

  it.each([
    ['1', 1],
    ['10000', 10000],
    [' 5 ', 5],
    [' 250 ', 250],
  ])('ngoài production chấp nhận %p -> %p', (raw, expected) => {
    expect(resolveAuthLoginThrottleLimit(raw, 'development')).toBe(expected);
    expect(resolveAuthLoginThrottleLimit(raw, undefined)).toBe(expected);
  });

  it.each(['10001', '0', '-1', '0x10', '1e3', '5.0', 'abc', '99999999'])(
    'ngoài production từ chối giá trị không hợp lệ %p',
    (raw) => {
      expect(() => resolveAuthLoginThrottleLimit(raw, 'development')).toThrow(
        AUTH_LOGIN_THROTTLE_ENV,
      );
    },
  );
});

describe('reportAuthLoginThrottleStartup', () => {
  const makeLog = () => ({ warn: jest.fn() });

  it('không log khi giữ mặc định (chưa đặt hoặc bằng 5)', () => {
    const log = makeLog();
    reportAuthLoginThrottleStartup(undefined, 'development', log);
    reportAuthLoginThrottleStartup('5', 'development', log);
    reportAuthLoginThrottleStartup(undefined, 'production', log);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('ngoài production + giá trị khác 5: warn đúng một lần, nói rõ chỉ dùng cho dev/E2E', () => {
    const log = makeLog();
    reportAuthLoginThrottleStartup('1000', 'development', log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dev/E2E'));
  });

  it('production + biến khác mặc định: warn đúng một lần là biến bị bỏ qua', () => {
    const log = makeLog();
    reportAuthLoginThrottleStartup('1000', 'production', log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('bỏ qua'));
  });

  it('giá trị không hợp lệ ngoài production vẫn ném lỗi khi khởi tạo', () => {
    expect(() =>
      reportAuthLoginThrottleStartup('0x10', 'development', makeLog()),
    ).toThrow(AUTH_LOGIN_THROTTLE_ENV);
  });
});

describe('AuthController.login @Throttle wiring', () => {
  const original = {
    limit: process.env[AUTH_LOGIN_THROTTLE_ENV],
    nodeEnv: process.env.NODE_ENV,
  };

  afterEach(() => {
    if (original.limit === undefined)
      delete process.env[AUTH_LOGIN_THROTTLE_ENV];
    else process.env[AUTH_LOGIN_THROTTLE_ENV] = original.limit;
    process.env.NODE_ENV = original.nodeEnv;
  });

  // Đọc metadata thật mà @nestjs/throttler gắn lên handler `login`.
  const readLimit = (): unknown =>
    Reflect.getMetadata(
      THROTTLER_LIMIT + 'default',
      // eslint-disable-next-line @typescript-eslint/unbound-method -- chỉ làm khóa đọc metadata, không gọi
      AuthController.prototype.login,
    );

  it('controller dùng hàm limit đọc env lúc request, TTL 60s', () => {
    const limit = readLimit();
    expect(typeof limit).toBe('function');
    expect(
      Reflect.getMetadata(
        THROTTLER_TTL + 'default',
        // eslint-disable-next-line @typescript-eslint/unbound-method -- chỉ làm khóa đọc metadata, không gọi
        AuthController.prototype.login,
      ),
    ).toBe(AUTH_LOGIN_THROTTLE_TTL_MS);

    const limitFn = limit as () => number;
    process.env.NODE_ENV = 'test';
    delete process.env[AUTH_LOGIN_THROTTLE_ENV];
    expect(limitFn()).toBe(5);
    process.env[AUTH_LOGIN_THROTTLE_ENV] = '321';
    expect(limitFn()).toBe(321);
    process.env.NODE_ENV = 'production';
    expect(limitFn()).toBe(5);
  });

  it('khởi tạo controller fail-fast khi biến sai (ngoài production)', () => {
    process.env.NODE_ENV = 'test';
    process.env[AUTH_LOGIN_THROTTLE_ENV] = '0x10';
    expect(() => new AuthController({} as AuthService)).toThrow(
      AUTH_LOGIN_THROTTLE_ENV,
    );
  });
});
