import {
  PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS,
  PushRevokedReason,
} from './push-subscription.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bộ `$set` thu hồi mềm một subscription: đặt `revokedAt`, lý do và `purgeAt = revokedAt + 7 ngày`
 * (TTL index tự xóa sau đó). Dùng chung cho mọi đường thu hồi để không lệch hạn giữ.
 */
export function buildRevocationSet(
  reason: PushRevokedReason,
  revokedAt: Date = new Date(),
): { revokedAt: Date; revokedReason: PushRevokedReason; purgeAt: Date } {
  return {
    revokedAt,
    revokedReason: reason,
    purgeAt: new Date(
      revokedAt.getTime() + PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS * DAY_MS,
    ),
  };
}
