export const TRUST_PROXY_ENV = 'TRUST_PROXY';
/** Trần số hop: giá trị lớn gần như "tin mọi hop" (giả mạo được IP) nên bị chặn. */
export const TRUST_PROXY_MAX_HOPS = 10;

/**
 * Đọc `TRUST_PROXY` -> giá trị `trustProxy` của FastifyAdapter.
 * - Chưa đặt/rỗng/toàn khoảng trắng/`0` -> `false` (tắt: dev chạy thẳng, req.ip là IP kết nối).
 * - Số hop nguyên dương (1..10), chỉ gồm chữ số sau khi trim -> số hop đó
 *   (production sau nginx = `1`: chỉ tin đúng 1 proxy, IP client lấy từ X-Forwarded-For do nginx ghi đè).
 * - Mọi giá trị khác ('true', 'abc', '-1', '1.5', '0x1', '11'...) -> ném lỗi (fail-fast).
 *   TUYỆT ĐỐI không chấp nhận `true`: tin mọi hop cho phép client giả mạo IP, vô hiệu rate limit.
 */
export function resolveTrustProxy(
  raw: string | undefined = process.env[TRUST_PROXY_ENV],
): number | false {
  const text = raw?.trim() ?? '';
  if (text === '') {
    return false;
  }
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value > TRUST_PROXY_MAX_HOPS) {
    throw new Error(
      `${TRUST_PROXY_ENV} phải là số hop nguyên dương (1..${TRUST_PROXY_MAX_HOPS}) hoặc để trống/0 để tắt; không chấp nhận "true", nhận được "${raw}"`,
    );
  }
  return value === 0 ? false : value;
}
