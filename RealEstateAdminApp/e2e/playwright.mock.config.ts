import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright MOCK (không cần backend/Mongo/Redis/MinIO): chỉ dựng Vite rồi trả lời mọi gọi API bằng `page.route`.
 * Dùng cho kiểm tra hình học/giao diện thuần FE (vd. dropdown thông báo T-57, FR-38). Chạy: `npm run e2e:mock`.
 * Khác `playwright.config.ts` (stack cô lập đầy đủ): không có globalSetup nên chạy được ngay trên máy chỉ cài Node + Chromium.
 */
export const MOCK_ADMIN_PORT = 5184;
export const MOCK_API_ORIGIN = 'http://localhost:3199';

export default defineConfig({
  testDir: './specs-mock',
  outputDir: '../test-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${MOCK_ADMIN_PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    screenshot: 'only-on-failure',
  },
  // Vite riêng cổng 5184 (khác dev 5173 và stack e2e 5183), API trỏ về origin giả; cờ CRM bật, dữ liệu mẫu tắt.
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --port 5184 --strictPort --host localhost',
    cwd: '..',
    url: `http://localhost:${MOCK_ADMIN_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_URL: `${MOCK_API_ORIGIN}/api/v1`,
      VITE_CRM_ENABLED: 'true',
      VITE_CRM_MOCK_REPORTS: 'false',
      VITE_CRM_MOCK_IMPORT_EXPORT: 'false',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
