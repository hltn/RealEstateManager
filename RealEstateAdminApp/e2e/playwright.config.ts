import { defineConfig, devices } from '@playwright/test';
import { URLS } from './env';

/**
 * E2E CRM. Stack cô lập (backend :3100, Vite :5183, Mongo tạm, Redis db 15, bucket e2e-*) do globalSetup dựng và dọn.
 * Chạy: `npm run e2e` (từ RealEstateAdminApp). Xem e2e/README.md.
 * globalSetup giữ khóa chạy (e2e/.runtime/e2e.run.lock) nên 2 lần chạy không giẫm nhau; báo cáo HTML nằm ở RealEstateAdminApp/playwright-report.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: '../test-results',
  globalSetup: './global-setup.ts',
  // 1 stack dùng chung + login bị throttle => chạy tuần tự cho ổn định (spec tự tạo dữ liệu riêng nên có thể tăng sau).
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL: URLS.admin,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
