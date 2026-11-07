/**
 * API đăng ký Web Push của thiết bị (T-40, FR-09, FR-01; hợp đồng Architecture 4.1). Lỗi ném `CrmApiException` (qua `crmHttp`).
 */
import { crmHttp } from './crmHttp';

/** `GET /push-subscriptions/config`: `publicKey` chỉ có khi `enabled = true` (lấy lúc chạy, không nhúng vào bundle). */
export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

/** Thân `POST /push-subscriptions` (đúng dạng `PushSubscription.toJSON()`). */
export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

/** Kết quả đăng ký/làm tươi; `displaced` là thiết bị bị gỡ để nhường chỗ khi vượt 3 thiết bị. */
export interface PushRegistration {
  id: string;
  deviceLabel: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  displaced: { id: string; deviceLabel: string } | null;
}

export const fetchPushConfig = (signal?: AbortSignal): Promise<PushConfig> => crmHttp.get<PushConfig>('/push-subscriptions/config', { signal });

/** Upsert theo `endpoint` (201 mới hoặc 200 làm tươi, cùng dạng phản hồi). */
export const registerPushSubscription = (body: PushSubscriptionBody): Promise<PushRegistration> => crmHttp.post<PushRegistration>('/push-subscriptions', body);

/** `DELETE /push-subscriptions/:id` (204, idempotent). */
export const deletePushSubscription = (id: string): Promise<void> => crmHttp.del(`/push-subscriptions/${encodeURIComponent(id)}`);
