/**
 * API cài đặt thông báo của chính người dùng (T-42, FR-10, FR-43; hợp đồng Architecture 4.1, BE `notification-preferences.controller.ts`).
 * Lỗi ném `CrmApiException` (qua `crmHttp`).
 */
import { crmHttp } from './crmHttp';

/** Tùy chọn của một loại thông báo. `push` chỉ có tác dụng khi `inApp` bật (tắt `inApp` = không có thông báo trong app VÀ không push). */
export interface TypePreference {
  push: boolean;
  inApp: boolean;
}

/** Giờ yên lặng theo giờ Việt Nam: `start` bao gồm, `end` không bao gồm, `HH:mm`, `start` khác `end`, được phép qua nửa đêm. */
export interface QuietHours {
  start: string;
  end: string;
}

/** Một loại có push trong danh mục (nguồn `PUSH_CATALOG` của máy chủ; FE không tự khai báo danh sách). */
export interface PushTypeInfo {
  type: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  canDisable: boolean;
}

/** Phản hồi `GET/PUT /notification-preferences/me`: `types` đủ mọi loại (loại chưa lưu = bật cả hai). */
export interface NotificationPreferences {
  types: Record<string, TypePreference>;
  quietHours: QuietHours | null;
  pushTypes: PushTypeInfo[];
}

/** Thân `PUT`: chỉ gửi loại đổi; `quietHours: null` = tắt, bỏ khóa = giữ nguyên. */
export interface UpdateNotificationPreferencesBody {
  types: Record<string, TypePreference>;
  quietHours?: QuietHours | null;
}

export const fetchNotificationPreferences = (signal?: AbortSignal): Promise<NotificationPreferences> =>
  crmHttp.get<NotificationPreferences>('/notification-preferences/me', { signal });

export const updateNotificationPreferences = (body: UpdateNotificationPreferencesBody): Promise<NotificationPreferences> =>
  crmHttp.put<NotificationPreferences>('/notification-preferences/me', body);
