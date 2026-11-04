/**
 * Dọn stack E2E: tắt Vite + backend, flush Redis db 15, xóa object + bucket e2e-*, Mongo tạm, nhả khóa chạy.
 * Idempotent, không ném lỗi. Bước phá hủy dữ liệu (Redis/bucket) chỉ chạy khi `ownsData` (đã qua kiểm cổng trống)
 * và `assertIsolated()` còn đạt.
 */
import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { PATHS, S3, assertIsolated } from './env';
import { dropBucket, flushRedis, killTree } from './lib/infra';

export interface Handles {
  admin?: ChildProcess;
  backend?: ChildProcess;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mongo?: { stop: (cleanup?: any) => Promise<unknown> };
  /** Nhả khóa chạy (lấy ở đầu globalSetup). */
  releaseLock?: () => void;
  /** Đã xác nhận cổng trống và được phép dọn dữ liệu E2E (Redis db 15, bucket e2e-*). */
  ownsData?: boolean;
}

export async function teardownAll(h: Handles): Promise<void> {
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      console.warn(`[E2E] dọn "${name}" lỗi: ${(e as Error).message}`);
    }
  };
  await step('vite', () => killTree(h.admin));
  await step('backend', () => killTree(h.backend));
  if (h.ownsData) {
    // Cảnh báo sớm nếu cấu hình lệch phạm vi cô lập; flushRedis/dropBucket cũng tự gọi assertIsolated nên sẽ từ chối xóa.
    await step('kiểm cô lập', () => assertIsolated());
    await step('redis db15', flushRedis);
    await step('bucket attachments', () => dropBucket(S3.bucketAttachments));
    await step('bucket exports', () => dropBucket(S3.bucketExports));
    // state.json thuộc về stack đang chạy: chỉ xóa khi chính lần chạy này đã xác nhận sở hữu stack (cổng trống).
    await step('state', () => fs.rmSync(PATHS.stateFile, { force: true }));
  }
  await step('mongo tạm', () => h.mongo?.stop());
  await step('khóa chạy', () => h.releaseLock?.());
}
