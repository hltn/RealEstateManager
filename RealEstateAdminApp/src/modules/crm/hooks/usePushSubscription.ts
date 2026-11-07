/**
 * Hook đăng ký/hủy Web Push của THIẾT BỊ NÀY (T-40, FR-09, FR-01; Architecture 6.2).
 * - Khóa công khai VAPID lấy lúc chạy từ `GET /push-subscriptions/config` (không nhúng vào bundle).
 * - Không bao giờ tự xin quyền: `enable` chỉ chạy khi nơi gọi gọi nó từ thao tác bấm nút.
 * - Đã `subscribed` thì làm tươi `POST /push-subscriptions` tối đa 1 lần/24 giờ (cập nhật `lastSeenAt`, chống bị dọn 90 ngày).
 * - Id subscription lưu `localStorage` để `auth.api.logout` gửi kèm khi đăng xuất.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { deletePushSubscription, fetchPushConfig, registerPushSubscription, type PushRegistration } from '@crm/api/http/pushApi';
import { toApiError } from '@crm/api/http/crmErrors';
import { isPushRefreshDue, type PushDeviceState } from '../../../pwa/pushDeviceState';
import { PushClientError, enablePush, readDeviceSnapshot, toSubscriptionBody, unsubscribeLocalPush } from '../../../pwa/pushClient';
import { clearPushRegistration, readPushLastRefreshAt, readPushSubscriptionId, savePushRegistration } from '../../../pwa/pushStorage';

export const pushKeys = {
  all: ['push'] as const,
  config: ['push', 'config'] as const,
  device: ['push', 'device'] as const,
};

const CONFIG_STALE_MS = 5 * 60 * 1000;

/**
 * Làm tươi đăng ký với server khi đến hạn (hoặc chưa có id đã lưu, ví dụ localStorage bị xóa). Lỗi chỉ bỏ qua:
 * đây là việc nền, lần mở app sau sẽ thử lại và không được làm hỏng việc hiển thị trạng thái.
 */
export const refreshPushSubscriptionIfDue = async (subscription: PushSubscription, now: number = Date.now()): Promise<void> => {
  if (readPushSubscriptionId() && !isPushRefreshDue(readPushLastRefreshAt(), now)) return;
  try {
    const registration = await registerPushSubscription(toSubscriptionBody(subscription));
    savePushRegistration(registration.id, now);
  } catch {
    // Thử lại ở lần kế tiếp (mốc làm tươi chưa được ghi nên vẫn "đến hạn").
  }
};

const toErrorMessage = (error: unknown): string => (error instanceof PushClientError ? error.message : toApiError(error).message);

export interface UsePushSubscriptionResult {
  /** Trạng thái thiết bị; `null` khi đang xác định. */
  state: PushDeviceState | null;
  /** `GET /push-subscriptions/config` có `enabled = true` (cờ server + VAPID đủ). */
  isAvailable: boolean;
  /** Được hiện nút "Bật": cờ server bật VÀ thiết bị `ready` (iPhone chưa cài thì không bao giờ có). */
  canEnable: boolean;
  /** Được hiện nút "Tắt": thiết bị đang `subscribed` (cho tắt kể cả khi cờ server đã tắt). */
  canDisable: boolean;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  /** Gọi TRỰC TIẾP trong handler bấm nút. Trả đăng ký (kèm `displaced`) hoặc `null` nếu không bật được (xem `error`). */
  enable: () => Promise<PushRegistration | null>;
  /** Tắt thông báo thiết bị này: hủy ở trình duyệt, gỡ ở server (lỗi server không chặn việc tắt cục bộ). Trả `true` khi đã tắt. */
  disable: () => Promise<boolean>;
}

export const usePushSubscription = (): UsePushSubscriptionResult => {
  const queryClient = useQueryClient();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: pushKeys.config,
    queryFn: ({ signal }) => fetchPushConfig(signal),
    staleTime: CONFIG_STALE_MS,
    retry: 1,
  });
  const config = configQuery.data;
  const isAvailable = config?.enabled === true;

  // Đọc trạng thái trình duyệt (và làm tươi nếu đến hạn). Khóa có `isAvailable` để chạy lại ngay khi biết cờ server bật.
  const deviceQuery = useQuery({
    queryKey: [...pushKeys.device, isAvailable],
    queryFn: async (): Promise<PushDeviceState> => {
      const { state: deviceState, subscription } = await readDeviceSnapshot();
      if (isAvailable && deviceState === 'subscribed' && subscription) await refreshPushSubscriptionIfDue(subscription);
      return deviceState;
    },
    staleTime: 0,
    retry: false,
  });
  const state = deviceQuery.data ?? null;

  const refreshDevice = useCallback(() => queryClient.invalidateQueries({ queryKey: pushKeys.device }), [queryClient]);

  const enable = useCallback(async (): Promise<PushRegistration | null> => {
    const publicKey = config?.enabled ? config.publicKey : null;
    if (!publicKey) {
      setError('Thông báo đẩy chưa được bật trên hệ thống.');
      return null;
    }
    setIsBusy(true);
    setError(null);
    let created: PushSubscription | null = null;
    try {
      // `enablePush` xin quyền ngay lập tức (trong cử chỉ bấm), không `await` gì trước đó.
      const { subscription, isNew } = await enablePush(publicKey);
      created = isNew ? subscription : null;
      const registration = await registerPushSubscription(toSubscriptionBody(subscription));
      savePushRegistration(registration.id, Date.now());
      created = null;
      return registration;
    } catch (caught) {
      // Server từ chối thì không để subscription "mồ côi" ở trình duyệt (UI báo đang tắt nhưng push vẫn treo).
      await created?.unsubscribe().catch(() => false);
      setError(toErrorMessage(caught));
      return null;
    } finally {
      setIsBusy(false);
      await refreshDevice();
    }
  }, [config, refreshDevice]);

  const disable = useCallback(async (): Promise<boolean> => {
    setIsBusy(true);
    setError(null);
    try {
      const subscriptionId = readPushSubscriptionId();
      let isServerRemoved = true;
      if (subscriptionId) {
        try {
          await deletePushSubscription(subscriptionId);
        } catch {
          isServerRemoved = false;
        }
      }
      await unsubscribeLocalPush();
      clearPushRegistration();
      if (!isServerRemoved) setError('Đã tắt trên thiết bị này nhưng chưa gỡ được ở máy chủ; thiết bị sẽ tự được gỡ khi không còn nhận được thông báo.');
      return true;
    } catch (caught) {
      setError(toErrorMessage(caught));
      return false;
    } finally {
      setIsBusy(false);
      await refreshDevice();
    }
  }, [refreshDevice]);

  return {
    state,
    isAvailable,
    canEnable: isAvailable && state === 'ready',
    canDisable: state === 'subscribed',
    isLoading: deviceQuery.isLoading,
    isBusy,
    error,
    enable,
    disable,
  };
};
