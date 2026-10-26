/**
 * Khóa chạy đồng thời cho `globalSetup` (lớp phòng thủ thứ hai khi chạy thẳng `npx playwright test`).
 * Logic nằm ở `run-lock.mjs` (dùng chung với wrapper `e2e/run.mjs`); nếu wrapper đã giữ khóa thì không khóa lại.
 */
import { PATHS } from '../env';
import { acquireRunLock as acquire } from './run-lock.mjs';

/** Lấy khóa (hoặc nhận biết khóa do wrapper giữ); ném lỗi rõ ràng nếu có lần chạy khác. Trả về hàm nhả khóa. */
export const acquireRunLock = (): (() => void) => acquire(PATHS.runLockDir);
