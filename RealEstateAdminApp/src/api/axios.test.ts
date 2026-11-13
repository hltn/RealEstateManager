import { afterEach, describe, expect, it, vi } from 'vitest';

/** Nạp lại `axios.ts` với `window.__APP_CONFIG__` giả (baseURL đọc một lần khi nạp module). */
const loadApiAxios = async (config?: unknown) => {
  if (config === undefined) delete window.__APP_CONFIG__;
  else window.__APP_CONFIG__ = config;
  vi.resetModules();
  return (await import('./axios')).default;
};

afterEach(() => {
  delete window.__APP_CONFIG__;
  vi.resetModules();
});

describe('FR-15 apiAxios.baseURL đọc runtimeConfig.API_URL', () => {
  it('không có cấu hình: mặc định /api/v1 (không còn localhost:3000)', async () => {
    const api = await loadApiAxios();
    expect(api.defaults.baseURL).toBe('/api/v1');
  });

  it('dùng API_URL do /env.js cấp', async () => {
    const api = await loadApiAxios({ API_URL: 'https://api.example.com/api/v1' });
    expect(api.defaults.baseURL).toBe('https://api.example.com/api/v1');
  });

  it('API_URL sai định dạng rơi về /api/v1', async () => {
    const api = await loadApiAxios({ API_URL: 'javascript:alert(1)' });
    expect(api.defaults.baseURL).toBe('/api/v1');
  });

  it('VITE_API_URL không còn hiệu lực', async () => {
    const api = await loadApiAxios({ VITE_API_URL: 'http://evil.example.com' });
    expect(api.defaults.baseURL).toBe('/api/v1');
  });

  it('vẫn gửi cookie và timeout 30s', async () => {
    const api = await loadApiAxios();
    expect(api.defaults.withCredentials).toBe(true);
    expect(api.defaults.timeout).toBe(30_000);
  });
});
