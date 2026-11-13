import { afterEach, describe, expect, it, vi } from 'vitest';

/** Nạp lại `featureFlags` với `window.__APP_CONFIG__` giả (cờ đọc một lần khi nạp module). */
const loadFlags = async (config?: unknown) => {
  if (config === undefined) delete window.__APP_CONFIG__;
  else window.__APP_CONFIG__ = config;
  vi.resetModules();
  return (await import('./featureFlags')).CRM_FEATURE_FLAGS;
};

afterEach(() => {
  delete window.__APP_CONFIG__;
  vi.resetModules();
});

describe('FR-15 featureFlags đọc runtimeConfig, mặc định tắt toàn bộ (kể cả ở dev/vitest)', () => {
  it('không có cấu hình: mọi cờ tắt, KHÔNG bật theo import.meta.env.DEV', async () => {
    expect(import.meta.env.DEV).toBe(true);
    const flags = await loadFlags();
    expect(Object.values(flags).every((value) => value === false)).toBe(true);
  });

  it('ZNS, gọi trong app, đồng bộ lịch đều tắt (fallback tel:/zalo.me)', async () => {
    const flags = await loadFlags({});
    expect(flags.isZaloZnsEnabled).toBe(false);
    expect(flags.isInAppCallEnabled).toBe(false);
    expect(flags.isAppointmentNotifySyncEnabled).toBe(false);
  });

  it('giá trị sai kiểu rơi về tắt', async () => {
    const flags = await loadFlags({ CRM_ENABLED: 'yes', CRM_MOCK_REPORTS: 1 });
    expect(flags.isPrototypeEnabled).toBe(false);
    expect(flags.isMockReportsEnabled).toBe(false);
  });

  it('tên VITE_* và tên cờ BE cũ không còn hiệu lực', async () => {
    const flags = await loadFlags({ VITE_CRM_ENABLED: 'true', VITE_FEATURE_CRM_ATTACHMENTS: 'true', FEATURE_CRM_ENABLED: true });
    expect(flags.isPrototypeEnabled).toBe(false);
    expect(flags.isAttachmentsEnabled).toBe(false);
  });
});

describe('FR-15 featureFlags ánh xạ đúng từng khóa runtimeConfig', () => {
  it.each([
    ['CRM_ENABLED', 'isPrototypeEnabled'],
    ['CRM_ATTACHMENTS_ENABLED', 'isAttachmentsEnabled'],
    ['CRM_FEATURE_ZALO_ZNS', 'isZaloZnsEnabled'],
    ['CRM_FEATURE_IN_APP_CALL', 'isInAppCallEnabled'],
    ['CRM_FEATURE_APPOINTMENT_SYNC', 'isAppointmentNotifySyncEnabled'],
    ['CRM_MOCK_REPORTS', 'isMockReportsEnabled'],
    ['CRM_MOCK_IMPORT_EXPORT', 'isMockImportExportEnabled'],
  ] as const)('%s=true chỉ bật %s', async (configKey, flagKey) => {
    const flags = await loadFlags({ [configKey]: true });
    expect(flags[flagKey]).toBe(true);
    const others = Object.entries(flags).filter(([key]) => key !== flagKey);
    expect(others.length).toBe(6);
    expect(others.every(([, value]) => value === false)).toBe(true);
  });

  it('chuỗi "true" từ /env.js cũng được nhận', async () => {
    expect((await loadFlags({ CRM_ENABLED: 'true' })).isPrototypeEnabled).toBe(true);
  });

  it('đối tượng cờ bị đóng băng', async () => {
    expect(Object.isFrozen(await loadFlags({ CRM_ENABLED: true }))).toBe(true);
  });
});
