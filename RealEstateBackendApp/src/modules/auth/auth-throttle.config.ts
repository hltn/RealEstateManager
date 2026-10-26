import { Logger } from '@nestjs/common';

/** Giới hạn mặc định của POST /auth/login (lần/phút/IP). */
export const AUTH_LOGIN_THROTTLE_DEFAULT_LIMIT = 5;
/** Trần cho phép khi nới giới hạn ở dev/E2E (ngoài production). */
export const AUTH_LOGIN_THROTTLE_MAX_LIMIT = 10_000;
export const AUTH_LOGIN_THROTTLE_TTL_MS = 60_000;
export const AUTH_LOGIN_THROTTLE_ENV = 'AUTH_LOGIN_THROTTLE_LIMIT';

const logger = new Logger('AuthThrottle');

/**
 * Đọc `AUTH_LOGIN_THROTTLE_LIMIT`. Chỉ dùng cho dev/E2E.
 * - production: LUÔN trả 5, bỏ qua biến (kể cả khi biến sai định dạng, không làm sập app).
 * - Ngoài production: chưa đặt/rỗng/toàn khoảng trắng -> 5; sau khi trim phải là chuỗi
 *   số nguyên dương thuần (`/^\d+$/`, từ chối '0x10', '1e3', '5.0', '-1') trong 1..10000,
 *   ngược lại ném lỗi (fail-fast, không im lặng nới lỏng).
 */
export function resolveAuthLoginThrottleLimit(
  raw: string | undefined = process.env[AUTH_LOGIN_THROTTLE_ENV],
  nodeEnv: string | undefined = process.env.NODE_ENV,
): number {
  if (nodeEnv === 'production') {
    return AUTH_LOGIN_THROTTLE_DEFAULT_LIMIT;
  }
  const text = raw?.trim() ?? '';
  if (text === '') {
    return AUTH_LOGIN_THROTTLE_DEFAULT_LIMIT;
  }
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > AUTH_LOGIN_THROTTLE_MAX_LIMIT
  ) {
    throw new Error(
      `${AUTH_LOGIN_THROTTLE_ENV} phải là số nguyên dương (1..${AUTH_LOGIN_THROTTLE_MAX_LIMIT}), nhận được "${raw}"`,
    );
  }
  return value;
}

/**
 * Gọi MỘT lần lúc khởi tạo controller: kiểm tra fail-fast giá trị biến và ghi `warn`
 * khi giới hạn đăng nhập bị nới (dev/E2E) hoặc biến bị bỏ qua (production).
 */
export function reportAuthLoginThrottleStartup(
  raw: string | undefined = process.env[AUTH_LOGIN_THROTTLE_ENV],
  nodeEnv: string | undefined = process.env.NODE_ENV,
  log: Pick<Logger, 'warn'> = logger,
): void {
  const limit = resolveAuthLoginThrottleLimit(raw, nodeEnv);
  const text = raw?.trim() ?? '';
  if (nodeEnv === 'production') {
    if (text !== '' && text !== String(AUTH_LOGIN_THROTTLE_DEFAULT_LIMIT)) {
      log.warn(
        `${AUTH_LOGIN_THROTTLE_ENV} bị bỏ qua ở production, giới hạn đăng nhập giữ mặc định ${AUTH_LOGIN_THROTTLE_DEFAULT_LIMIT}/phút/IP`,
      );
    }
    return;
  }
  if (limit !== AUTH_LOGIN_THROTTLE_DEFAULT_LIMIT) {
    log.warn(
      `Giới hạn đăng nhập đang được nới lên ${limit}/phút/IP, chỉ dùng cho dev/E2E`,
    );
  }
}
