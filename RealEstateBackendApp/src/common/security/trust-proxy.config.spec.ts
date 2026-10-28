import { resolveTrustProxy, TRUST_PROXY_ENV } from './trust-proxy.config';

describe('resolveTrustProxy', () => {
  // Hàm mặc định đọc process.env khi tham số là undefined: cô lập để test không phụ thuộc môi trường chạy.
  const originalEnv = process.env[TRUST_PROXY_ENV];
  beforeAll(() => {
    delete process.env[TRUST_PROXY_ENV];
  });
  afterAll(() => {
    if (originalEnv !== undefined) process.env[TRUST_PROXY_ENV] = originalEnv;
  });

  it.each([[undefined], [''], ['   '], ['0'], [' 0 ']])(
    'tắt trustProxy khi %p',
    (raw) => {
      expect(resolveTrustProxy(raw)).toBe(false);
    },
  );

  it.each([
    ['1', 1],
    [' 1 ', 1],
    ['2', 2],
    ['10', 10],
  ])('nhận số hop %p -> %p', (raw, expected) => {
    expect(resolveTrustProxy(raw)).toBe(expected);
  });

  it.each(['-1', '1.5', 'true', 'TRUE', 'abc', '0x1', '1e1', '11', '1 2'])(
    'từ chối giá trị không hợp lệ %p (fail-fast)',
    (raw) => {
      expect(() => resolveTrustProxy(raw)).toThrow(TRUST_PROXY_ENV);
    },
  );
});
