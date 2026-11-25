/**
 * Lưu cục bộ của Web Push (T-40, FR-01): id subscription do API cấp (gửi kèm khi đăng xuất để thu hồi đúng thiết bị này)
 * và mốc làm tươi gần nhất (chặn `POST /push-subscriptions` quá 1 lần/24 giờ). localStorage lỗi (private mode, quota) thì bỏ qua.
 */

export const PUSH_SUBSCRIPTION_ID_KEY = 'push.subscriptionId';
export const PUSH_LAST_REFRESH_KEY = 'push.lastRefreshAt';

const readItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Bỏ qua: lần sau chỉ làm tươi sớm hơn dự kiến hoặc đăng xuất không kèm id (server vẫn xử lý bình thường).
  }
};

const removeItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Bỏ qua lỗi truy cập localStorage.
  }
};

/** Id subscription đã lưu; chuỗi rỗng coi như chưa có. */
export const readPushSubscriptionId = (): string | null => readItem(PUSH_SUBSCRIPTION_ID_KEY) || null;

export const readPushLastRefreshAt = (): number | null => {
  const raw = readItem(PUSH_LAST_REFRESH_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Ghi nhận một lần đăng ký/làm tươi thành công: lưu id và mốc thời gian. */
export const savePushRegistration = (subscriptionId: string, now: number): void => {
  writeItem(PUSH_SUBSCRIPTION_ID_KEY, subscriptionId);
  writeItem(PUSH_LAST_REFRESH_KEY, String(now));
};

/** Quên bản ghi cục bộ (tắt thông báo hoặc đăng xuất): lần đăng nhập sau sẽ làm tươi ngay thay vì đợi 24 giờ. */
export const clearPushRegistration = (): void => {
  removeItem(PUSH_SUBSCRIPTION_ID_KEY);
  removeItem(PUSH_LAST_REFRESH_KEY);
};
