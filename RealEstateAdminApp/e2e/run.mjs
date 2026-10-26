/**
 * Wrapper chạy E2E: lấy khóa chạy đồng thời TRƯỚC khi spawn Playwright.
 * Lý do: Playwright xóa `outputDir` (test-results) trước cả khi chạy globalSetup, nên nếu chỉ khóa trong globalSetup thì
 * lần chạy thứ hai (bị từ chối đúng) vẫn kịp xóa trace/ảnh của lần một đang chạy.
 *
 * Dùng: `node e2e/run.mjs [đối số của playwright test...]` (qua `npm run e2e`). Chuyển tiếp mọi đối số, mã thoát và tín hiệu;
 * luôn nhả khóa khi kết thúc (kể cả lỗi). Dừng cứng wrapper thì khóa mồ côi được lần chạy sau tự nhận ra (PID đã chết).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_OWNER_ENV, acquireRunLock } from './lib/run-lock.mjs';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const adminDir = path.resolve(e2eDir, '..');
const lockDir = path.resolve(e2eDir, '.runtime/e2e.run.lock');

let release;
try {
  release = acquireRunLock(lockDir);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const playwrightCli = createRequire(path.join(adminDir, 'package.json')).resolve('@playwright/test/cli');
const child = spawn(process.execPath, [playwrightCli, 'test', '-c', path.join(e2eDir, 'playwright.config.ts'), ...process.argv.slice(2)], {
  cwd: adminDir,
  stdio: 'inherit',
  // globalSetup đọc biến này để biết khóa đã do wrapper giữ.
  env: { ...process.env, [LOCK_OWNER_ENV]: String(process.pid) },
});

// Chuyển tiếp tín hiệu (Ctrl+C, kill) cho Playwright để nó kịp teardown; wrapper chờ nó thoát rồi mới nhả khóa.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => child.kill(sig));

child.on('error', (e) => {
  console.error(`[E2E] không khởi chạy được Playwright: ${e.message}`);
  release();
  process.exit(1);
});
child.on('exit', (code, signal) => {
  release();
  process.exit(code ?? (signal ? 130 : 1));
});
