import { describe, expect, it, vi } from 'vitest';
import {
  APP_URL_ENV_NAME,
  buildRuntimeConfigScript,
  createRuntimeConfigMiddleware,
  pickRuntimeConfig,
  type RuntimeConfigResponse,
} from './devRuntimeConfig';
import { parseRuntimeConfig } from './runtimeConfig';
import { RUNTIME_BOOLEAN_KEYS } from './runtimeConfigSchema';

/** Chạy nội dung `/env.js` như trình duyệt rồi đọc lại `window.__APP_CONFIG__`. */
const evaluateScript = (script: string): unknown => {
  const sandbox: { __APP_CONFIG__?: unknown } = {};
  new Function('window', script)(sandbox);
  return sandbox.__APP_CONFIG__;
};

describe('FR-15 pickRuntimeConfig (allowlist cho /env.js dev)', () => {
  it('env rỗng -> không phát khóa nào (FE rơi về mặc định)', () => {
    expect(pickRuntimeConfig({})).toEqual({});
  });

  it('phát đủ 11 khóa allowlist khi giá trị hợp lệ, appUrl lấy từ FRONTEND_URL', () => {
    const env: Record<string, string> = { API_URL: 'http://localhost:3000/api/v1', [APP_URL_ENV_NAME]: 'https://crm.example.com' };
    for (const key of RUNTIME_BOOLEAN_KEYS) env[key] = 'true';
    const picked = pickRuntimeConfig(env);
    expect(Object.keys(picked).sort()).toEqual([...RUNTIME_BOOLEAN_KEYS, 'API_URL', 'appUrl'].sort());
    expect(Object.keys(picked)).toHaveLength(11);
    expect(picked.appUrl).toBe('https://crm.example.com');
    expect(picked.API_URL).toBe('http://localhost:3000/api/v1');
    for (const key of RUNTIME_BOOLEAN_KEYS) expect(picked[key], key).toBe(true);
  });

  it('cờ false được giữ nguyên là boolean false (phân biệt với "không đặt")', () => {
    expect(pickRuntimeConfig({ CRM_MOCK_REPORTS: 'false' })).toEqual({ CRM_MOCK_REPORTS: false });
  });

  it('KHÔNG rò khóa ngoài allowlist (mật khẩu, secret, DB, khóa lạ, tên cũ VITE_*, FEATURE_CRM_*)', () => {
    const picked = pickRuntimeConfig({
      JWT_SECRET: 'bi-mat',
      ADMIN_PASSWORD: 'mat-khau',
      MONGODB_URI: 'mongodb://root:pw@host/db',
      S3_SECRET_ACCESS_KEY: 'khoa-s3',
      VITE_CRM_ENABLED: 'true',
      FEATURE_CRM_ENABLED: 'true',
      appUrl: 'https://khong-phai-khoa-env.example.com',
      CRM_ENABLED: 'true',
    });
    expect(picked).toEqual({ CRM_ENABLED: true });
    expect(JSON.stringify(picked)).not.toMatch(/bi-mat|mat-khau|mongodb|khoa-s3/);
  });

  it.each(['', ' ', 'TRUE', '1', 'yes', 'on', 'maybe'])('cờ boolean giá trị không hợp lệ %j bị bỏ', (value) => {
    expect(pickRuntimeConfig({ CRM_ENABLED: value })).toEqual({});
  });

  it.each(['', 'api/v1', '//evil.example.com', 'ftp://x.example.com', 'javascript:alert(1)', '/api"</script>'])('API_URL không hợp lệ %j bị bỏ', (value) => {
    expect(pickRuntimeConfig({ API_URL: value })).toEqual({});
  });

  it.each(['', '/relative', 'ftp://x.example.com', 'crm.example.com', 'https://a.example.com/"x', "https://a.example.com/'x", 'https://a b.example.com'])(
    'FRONTEND_URL không hợp lệ %j bị bỏ',
    (value) => {
      expect(pickRuntimeConfig({ FRONTEND_URL: value })).toEqual({});
    },
  );

  it('API_URL tương đối `/api/v1` hợp lệ; một giá trị sai không làm mất khóa hợp lệ khác', () => {
    expect(pickRuntimeConfig({ API_URL: '/api/v1', CRM_ENABLED: 'sai', CRM_PUSH_ENABLED: 'true' })).toEqual({ API_URL: '/api/v1', CRM_PUSH_ENABLED: true });
  });
});

describe('FR-15 buildRuntimeConfigScript', () => {
  it('là một câu lệnh gán window.__APP_CONFIG__; chạy xong parseRuntimeConfig đọc lại đúng giá trị', () => {
    const script = buildRuntimeConfigScript({ API_URL: 'http://localhost:3000/api/v1', CRM_ENABLED: 'true', FRONTEND_URL: 'https://crm.example.com' });
    expect(script.startsWith('window.__APP_CONFIG__ = ')).toBe(true);
    const config = parseRuntimeConfig(evaluateScript(script));
    expect(config.API_URL).toBe('http://localhost:3000/api/v1');
    expect(config.CRM_ENABLED).toBe(true);
    expect(config.CRM_PUSH_ENABLED).toBe(false);
    expect(config.appUrl).toBe('https://crm.example.com');
  });

  it('env rỗng vẫn là JS hợp lệ và FE nhận mặc định', () => {
    const config = parseRuntimeConfig(evaluateScript(buildRuntimeConfigScript({})));
    expect(config.CRM_ENABLED).toBe(false);
    expect(config.API_URL).toBe('/api/v1');
    expect(config.appUrl).toBe('');
  });
});

describe('FR-15 createRuntimeConfigMiddleware (/env.js của Vite dev)', () => {
  const makeResponse = () => {
    const headers: Record<string, string> = {};
    const res: RuntimeConfigResponse & { body?: string } = {
      statusCode: 0,
      setHeader: (name, value) => {
        headers[name] = value;
      },
      end: (body) => {
        res.body = body;
      },
    };
    return { res, headers };
  };

  it('GET /env.js: 200, JavaScript, no-store, nội dung từ readEnv', () => {
    const readEnv = vi.fn(() => ({ CRM_ENABLED: 'true', JWT_SECRET: 'bi-mat' }));
    const next = vi.fn();
    const { res, headers } = makeResponse();
    createRuntimeConfigMiddleware(readEnv)({ method: 'GET', url: '/env.js' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(headers['Content-Type']).toMatch(/^application\/javascript/);
    expect(headers['Cache-Control']).toBe('no-store');
    expect(res.body).toBe('window.__APP_CONFIG__ = {"CRM_ENABLED":true};\n');
    expect(res.body).not.toContain('bi-mat');
  });

  it('bỏ qua query string (/env.js?v=1) và đọc env MỖI request', () => {
    const readEnv = vi.fn().mockReturnValueOnce({ CRM_ENABLED: 'true' }).mockReturnValueOnce({ CRM_ENABLED: 'false' });
    const middleware = createRuntimeConfigMiddleware(readEnv);
    const first = makeResponse();
    const second = makeResponse();
    middleware({ method: 'GET', url: '/env.js?v=1' }, first.res, vi.fn());
    middleware({ method: 'GET', url: '/env.js' }, second.res, vi.fn());
    expect(first.res.body).toContain('"CRM_ENABLED":true');
    expect(second.res.body).toContain('"CRM_ENABLED":false');
    expect(readEnv).toHaveBeenCalledTimes(2);
  });

  it('HEAD /env.js: 200 và header nhưng không có thân', () => {
    const { res, headers } = makeResponse();
    createRuntimeConfigMiddleware(() => ({ CRM_ENABLED: 'true' }))({ method: 'HEAD', url: '/env.js' }, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(headers['Cache-Control']).toBe('no-store');
    expect(res.body).toBeUndefined();
  });

  it.each([
    ['GET', '/'],
    ['GET', '/assets/env.js'],
    ['GET', '/env.js/extra'],
    ['GET', '/env.json'],
    ['GET', undefined],
    ['POST', '/env.js'],
  ])('%s %s không phải việc của middleware -> next()', (method, url) => {
    const readEnv = vi.fn(() => ({}));
    const next = vi.fn();
    const { res } = makeResponse();
    createRuntimeConfigMiddleware(readEnv)({ method, url }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(readEnv).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});
