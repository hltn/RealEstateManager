import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_URL, parseRuntimeConfig, type RuntimeConfig } from './runtimeConfig';

const FLAG_KEYS = [
  'CRM_ENABLED',
  'CRM_ATTACHMENTS_ENABLED',
  'CRM_PUSH_ENABLED',
  'CRM_IMPORT_ENABLED',
  'CRM_FEATURE_ZALO_ZNS',
  'CRM_FEATURE_IN_APP_CALL',
  'CRM_FEATURE_APPOINTMENT_SYNC',
  'CRM_MOCK_REPORTS',
  'CRM_MOCK_IMPORT_EXPORT',
] as const satisfies readonly (keyof RuntimeConfig)[];

describe('FR-15 parseRuntimeConfig: mặc định', () => {
  it.each([undefined, null, {}, 'chuỗi', 42, [], [true]])('đầu vào %j -> mọi cờ false, API_URL=/api/v1, appUrl rỗng', (raw) => {
    const config = parseRuntimeConfig(raw);
    for (const key of FLAG_KEYS) expect(config[key], key).toBe(false);
    expect(config.API_URL).toBe(DEFAULT_API_URL);
    expect(config.API_URL).toBe('/api/v1');
    expect(config.appUrl).toBe('');
  });

  it('chỉ đặt một cờ thì các cờ còn lại vẫn false', () => {
    const config = parseRuntimeConfig({ CRM_ENABLED: true });
    expect(config.CRM_ENABLED).toBe(true);
    for (const key of FLAG_KEYS.filter((k) => k !== 'CRM_ENABLED')) expect(config[key], key).toBe(false);
  });

  it('kết quả bị đóng băng (không sửa được lúc chạy)', () => {
    expect(Object.isFrozen(parseRuntimeConfig({ CRM_ENABLED: true }))).toBe(true);
    expect(Object.isFrozen(parseRuntimeConfig(undefined))).toBe(true);
  });
});

describe('FR-15 parseRuntimeConfig: cờ boolean', () => {
  it.each(FLAG_KEYS)('%s nhận boolean và chuỗi "true"/"false"', (key) => {
    expect(parseRuntimeConfig({ [key]: true })[key]).toBe(true);
    expect(parseRuntimeConfig({ [key]: 'true' })[key]).toBe(true);
    expect(parseRuntimeConfig({ [key]: false })[key]).toBe(false);
    expect(parseRuntimeConfig({ [key]: 'false' })[key]).toBe(false);
  });

  it.each(['TRUE', 'True', '1', 'yes', 'on', '', ' true', 1, 0, null, {}, []])('giá trị sai kiểu %j rơi về false', (value) => {
    const config = parseRuntimeConfig({ CRM_ENABLED: value, CRM_MOCK_REPORTS: value });
    expect(config.CRM_ENABLED).toBe(false);
    expect(config.CRM_MOCK_REPORTS).toBe(false);
  });

  it('giá trị sai của một khóa không ảnh hưởng khóa hợp lệ khác', () => {
    const config = parseRuntimeConfig({ CRM_ENABLED: 'abc', CRM_PUSH_ENABLED: true });
    expect(config.CRM_ENABLED).toBe(false);
    expect(config.CRM_PUSH_ENABLED).toBe(true);
  });
});

describe('FR-15 parseRuntimeConfig: API_URL', () => {
  it.each(['/api/v1', '/api', '/', 'http://localhost:3000/api/v1', 'https://api.example.com/api/v1'])('nhận %s', (url) => {
    expect(parseRuntimeConfig({ API_URL: url }).API_URL).toBe(url);
  });

  it('cắt khoảng trắng hai đầu', () => {
    expect(parseRuntimeConfig({ API_URL: '  /api/v1  ' }).API_URL).toBe('/api/v1');
  });

  it.each([
    '',
    '   ',
    'api/v1',
    '//evil.example.com/api',
    'javascript:alert(1)',
    'ftp://example.com',
    'https://',
    '/api/v1"><script>',
    "/api/v1'",
    '/api v1',
    'https://a.example.com/x y',
    '/api\\v1',
    42,
    true,
    null,
    {},
  ])('sai định dạng/kiểu %j rơi về /api/v1', (value) => {
    expect(parseRuntimeConfig({ API_URL: value }).API_URL).toBe('/api/v1');
  });
});

describe('FR-15 parseRuntimeConfig: appUrl', () => {
  it('nhận URL http(s) tuyệt đối', () => {
    expect(parseRuntimeConfig({ appUrl: 'https://app.example.com' }).appUrl).toBe('https://app.example.com');
    expect(parseRuntimeConfig({ appUrl: ' http://10.0.0.5:8080 ' }).appUrl).toBe('http://10.0.0.5:8080');
  });

  it.each(['', '/relative', 'app.example.com', 'javascript:alert(1)', 'https://x"y', 'https://a b', 7, null, false])(
    'sai định dạng/kiểu %j -> rỗng (dùng origin)',
    (value) => {
      expect(parseRuntimeConfig({ appUrl: value }).appUrl).toBe('');
    },
  );
});

describe('FR-15 parseRuntimeConfig: allowlist', () => {
  it('khóa ngoài allowlist bị bỏ (kể cả khóa VITE_*, khóa cũ, khóa bí mật)', () => {
    const config = parseRuntimeConfig({
      CRM_ENABLED: true,
      VITE_API_URL: 'http://evil',
      FEATURE_CRM_ENABLED: true,
      JWT_SECRET: 'khong-duoc-lot',
      constructor: 'x',
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(config).sort()).toEqual([...FLAG_KEYS, 'API_URL', 'appUrl'].sort());
    expect(config.VITE_API_URL).toBeUndefined();
    expect(config.FEATURE_CRM_ENABLED).toBeUndefined();
    expect(config.JWT_SECRET).toBeUndefined();
    expect(config.CRM_ENABLED).toBe(true);
  });

  it('tên khóa phân biệt hoa thường (crm_enabled, crmEnabled không được tính)', () => {
    expect(parseRuntimeConfig({ crm_enabled: true, crmEnabled: true }).CRM_ENABLED).toBe(false);
  });
});

describe('FR-15 runtimeConfig đọc window.__APP_CONFIG__ một lần khi nạp module', () => {
  afterEach(() => {
    delete window.__APP_CONFIG__;
    vi.resetModules();
  });

  it('không có /env.js (window.__APP_CONFIG__ không đặt) -> mặc định', async () => {
    delete window.__APP_CONFIG__;
    vi.resetModules();
    const { runtimeConfig } = await import('./runtimeConfig');
    expect(runtimeConfig.CRM_ENABLED).toBe(false);
    expect(runtimeConfig.API_URL).toBe('/api/v1');
  });

  it('đọc giá trị do /env.js gán', async () => {
    window.__APP_CONFIG__ = { CRM_ENABLED: true, API_URL: 'https://api.example.com/api/v1', appUrl: 'https://app.example.com' };
    vi.resetModules();
    const { runtimeConfig } = await import('./runtimeConfig');
    expect(runtimeConfig.CRM_ENABLED).toBe(true);
    expect(runtimeConfig.API_URL).toBe('https://api.example.com/api/v1');
    expect(runtimeConfig.appUrl).toBe('https://app.example.com');
  });

  it('đổi window.__APP_CONFIG__ sau khi nạp không đổi runtimeConfig (hằng số của phiên)', async () => {
    window.__APP_CONFIG__ = { CRM_ENABLED: true };
    vi.resetModules();
    const { runtimeConfig } = await import('./runtimeConfig');
    window.__APP_CONFIG__ = { CRM_ENABLED: false };
    expect(runtimeConfig.CRM_ENABLED).toBe(true);
  });
});
