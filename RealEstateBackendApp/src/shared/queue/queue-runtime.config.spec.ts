import { ConfigService } from '@nestjs/config';
import { isQueueWorkersEnabled } from './queue-runtime.config';

const configWith = (value?: string | boolean) =>
  ({ get: () => value }) as unknown as ConfigService;

describe('isQueueWorkersEnabled', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it.each([
    ['true', true],
    [' ON ', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['bat-ky-gi', false],
    [true, true],
    [false, false],
  ])('cấu hình tường minh %p => %p (bất kể NODE_ENV)', (raw, expected) => {
    process.env.NODE_ENV = 'test';
    expect(isQueueWorkersEnabled(configWith(raw))).toBe(expected);
  });

  it('không cấu hình: tắt khi NODE_ENV=test, bật ở môi trường khác', () => {
    process.env.NODE_ENV = 'test';
    expect(isQueueWorkersEnabled(configWith(undefined))).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(isQueueWorkersEnabled(configWith(undefined))).toBe(true);
    expect(isQueueWorkersEnabled(configWith('  '))).toBe(true);
  });
});
