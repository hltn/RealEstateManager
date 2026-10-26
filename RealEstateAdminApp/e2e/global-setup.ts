/**
 * Dựng stack E2E cô lập bằng 1 lệnh: khóa chạy -> kiểm cô lập + cổng trống -> dọn sót lần trước -> Mongo tạm (replica set)
 * -> Redis db 15 + bucket e2e-* -> backend :3100 (build riêng .e2e-dist) -> seed -> Vite :5183.
 * Trả về hàm dọn (Playwright gọi sau khi chạy xong, kể cả khi test đỏ).
 */
import { ACCOUNTS, S3, assertIsolated } from './env';
import { assertPortsFree, dropBucket, ensureBucket, flushRedis, startAdmin, startBackend, startMongo, warmUp } from './lib/infra';
import { acquireRunLock } from './lib/run-lock';
import { seed } from './lib/seed';
import { teardownAll, type Handles } from './global-teardown';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const t0 = Date.now();
  // Khóa trước mọi việc khác: nếu có lần chạy khác đang sống thì dừng ngay (không đụng gì vào stack của họ).
  const handles: Handles = { releaseLock: acquireRunLock() };
  try {
    // Từ chối sớm nếu biến E2E_* ghi đè đã đưa cấu hình ra ngoài phạm vi cô lập.
    assertIsolated();
    // Cổng 3100/5183 bận (tiến trình mồ côi hoặc chạy không qua khóa) thì dừng TRƯỚC khi flush/xóa bất cứ thứ gì.
    await assertPortsFree();
    handles.ownsData = true;

    // Dọn sót của lần chạy bị dừng cứng (Redis db 15 và bucket e2e-*) rồi mới tạo mới.
    await flushRedis();
    await dropBucket(S3.bucketAttachments);
    await dropBucket(S3.bucketExports);

    const { repl, uri } = await startMongo();
    handles.mongo = repl;
    assertIsolated({ mongoUri: uri });
    await ensureBucket(S3.bucketAttachments);
    await ensureBucket(S3.bucketExports);
    handles.backend = await startBackend(uri, (c) => (handles.backend = c));
    assertIsolated({ mongoUri: uri });
    await seed(uri);
    handles.admin = await startAdmin((c) => (handles.admin = c));
    await warmUp();
    console.log(`[E2E] stack sẵn sàng sau ${((Date.now() - t0) / 1000).toFixed(1)}s (admin: ${ACCOUNTS.admin.email})`);
  } catch (e) {
    await teardownAll(handles);
    throw e;
  }
  return () => teardownAll(handles);
}
