/**
 * Khóa chạy đồng thời cho E2E: chỉ 1 lần chạy được sở hữu stack (cổng 3100/5183, Redis db 15, bucket e2e-*) tại một thời điểm.
 * Khóa là THƯ MỤC (mkdir nguyên tử) chứa `owner.json` { pid, startedAt }.
 * Khóa mồ côi do dừng cứng (Ctrl+C mạnh, máy treo) được nhận ra khi PID chủ không còn tồn tại và được tự dọn.
 * Không chờ: nếu khóa còn sống thì báo lỗi ngay để người chạy biết thay vì chạy chồng lên nhau.
 *
 * Viết bằng JS thuần (.mjs) để dùng chung cho 2 nơi:
 *  - wrapper `e2e/run.mjs` (lấy khóa TRƯỚC khi spawn Playwright, vì Playwright xóa `test-results` trước cả globalSetup);
 *  - `globalSetup` (lớp phòng thủ thứ hai khi chạy thẳng `npx playwright test`), qua `run-lock.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';

const OWNER_FILE = 'owner.json';
/** Thư mục khóa chưa có owner.json lâu hơn mức này coi là mồ côi (chủ chết giữa lúc mkdir và ghi owner). */
const ORPHAN_NO_OWNER_MS = 30_000;
/** Biến môi trường wrapper đặt cho Playwright để globalSetup biết khóa đã do wrapper giữ (khỏi tự khóa chính mình). */
export const LOCK_OWNER_ENV = 'E2E_RUN_LOCK_OWNER_PID';

/** `process.kill(pid, 0)` không gửi tín hiệu, chỉ kiểm tra tồn tại; EPERM nghĩa là tiến trình vẫn sống. */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, OWNER_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Mô tả chủ khóa nếu khóa còn "sống" (chủ còn chạy, hoặc vừa mới tạo chưa kịp ghi owner); undefined nếu mồ côi/trống. */
function describeLiveHolder(lockDir) {
  const owner = readOwner(lockDir);
  if (owner) return isPidAlive(owner.pid) ? `PID ${owner.pid}, bắt đầu ${owner.startedAt}` : undefined;
  try {
    const age = Date.now() - fs.statSync(lockDir).mtimeMs;
    return age < ORPHAN_NO_OWNER_MS ? 'chủ vừa tạo khóa, chưa ghi owner' : undefined;
  } catch {
    return undefined; // thư mục khóa vừa biến mất: coi như trống
  }
}

/**
 * Lấy khóa; ném lỗi rõ ràng nếu đang có lần chạy khác.
 * Nếu khóa đã do tiến trình cha (wrapper) giữ — `env[E2E_RUN_LOCK_OWNER_PID]` khớp PID trong owner.json và PID đó còn sống —
 * thì không lấy lại, trả về hàm nhả rỗng (wrapper tự nhả).
 * Trả về hàm nhả khóa (idempotent, chỉ nhả khi khóa vẫn là của tiến trình này).
 *
 * @param {string} lockDir thư mục khóa
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {() => void}
 */
export function acquireRunLock(lockDir, env = process.env) {
  const heldByParent = Number(env[LOCK_OWNER_ENV]);
  if (heldByParent && readOwner(lockDir)?.pid === heldByParent && isPidAlive(heldByParent)) return () => undefined;

  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(lockDir); // nguyên tử: thất bại với EEXIST nếu đã có
      fs.writeFileSync(path.join(lockDir, OWNER_FILE), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return () => {
        if (readOwner(lockDir)?.pid === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = describeLiveHolder(lockDir);
      if (holder) {
        throw new Error(
          `[E2E] Đang có lần chạy E2E khác giữ stack (${holder}). Đợi nó xong rồi chạy lại ` +
            `(khóa: ${lockDir}; nếu chắc chắn không còn tiến trình nào, xóa thư mục khóa).`,
        );
      }
      // Khóa mồ côi (PID đã chết): dọn rồi thử lấy lại.
      console.warn('[E2E] phát hiện khóa mồ côi từ lần chạy bị dừng cứng, đang dọn.');
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }
  throw new Error(`[E2E] Không lấy được khóa chạy ${lockDir} sau nhiều lần thử`);
}
