import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_BOOLEAN_KEYS } from '../src/config/runtimeConfigSchema.ts';
import { adminEnv, backendEnv } from './env.ts';

/**
 * Test đơn vị cho env của stack E2E: nếu tên cờ lệch với backend/Admin thì CRM bị tắt âm thầm trong E2E thật
 * (từng xảy ra khi backend đổi sang `CRM_ENABLED` mà `backendEnv()` còn `FEATURE_CRM_ENABLED`).
 */
const ENABLED_ADMIN_FLAGS = ['CRM_ENABLED', 'CRM_ATTACHMENTS_ENABLED'];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('e2e/env backendEnv()', () => {
  const be = backendEnv('mongodb://127.0.0.1:27018/e2e');

  it('bật CRM bằng tên cờ mới CRM_ENABLED / CRM_ATTACHMENTS_ENABLED', () => {
    expect(be.CRM_ENABLED).toBe('true');
    expect(be.CRM_ATTACHMENTS_ENABLED).toBe('true');
  });

  it('không còn tên cờ cũ FEATURE_CRM_* (backend không đọc nữa) và không có VITE_*', () => {
    const keys = Object.keys(be);
    expect(keys.filter((key) => key.startsWith('FEATURE_CRM'))).toEqual([]);
    expect(keys.filter((key) => key.startsWith('VITE_'))).toEqual([]);
  });
});

describe('e2e/env adminEnv()', () => {
  it('ép MỌI cờ boolean trong allowlist: chỉ CRM_ENABLED và CRM_ATTACHMENTS_ENABLED bật, còn lại "false"', () => {
    const admin = adminEnv();
    for (const key of RUNTIME_BOOLEAN_KEYS) {
      expect(admin[key], key).toBe(ENABLED_ADMIN_FLAGS.includes(key) ? 'true' : 'false');
    }
  });

  it('cờ trong .env/process.env của máy dev không lọt vào (CRM_PUSH_ENABLED, CRM_FEATURE_*, CRM_MOCK_* bật ở máy dev vẫn bị ép false)', () => {
    vi.stubEnv('CRM_PUSH_ENABLED', 'true');
    vi.stubEnv('CRM_IMPORT_ENABLED', 'true');
    vi.stubEnv('CRM_FEATURE_ZALO_ZNS', 'true');
    vi.stubEnv('CRM_MOCK_REPORTS', 'true');
    const admin = adminEnv();
    expect(admin.CRM_PUSH_ENABLED).toBe('false');
    expect(admin.CRM_IMPORT_ENABLED).toBe('false');
    expect(admin.CRM_FEATURE_ZALO_ZNS).toBe('false');
    expect(admin.CRM_MOCK_REPORTS).toBe('false');
  });

  it('API_URL trỏ backend E2E và không có khóa VITE_*', () => {
    const admin = adminEnv();
    expect(admin.API_URL).toBe('http://localhost:3100/api/v1');
    expect(Object.keys(admin).filter((key) => key.startsWith('VITE_'))).toEqual([]);
  });
});
