import { createHash } from 'crypto';

/** Số ký tự hex giữ lại của SHA-256 (đủ để đối chiếu log, không đủ để suy ngược endpoint). */
const ENDPOINT_HASH_LENGTH = 16;

/**
 * Băm `endpoint` của subscription để đưa vào log (FR-03, FR-15): `endpoint` thô là bí mật
 * (ai có endpoint + khóa là gửi được push) nên KHÔNG bao giờ được ghi log.
 */
export function hashPushEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return 'none';
  return createHash('sha256')
    .update(endpoint)
    .digest('hex')
    .slice(0, ENDPOINT_HASH_LENGTH);
}
