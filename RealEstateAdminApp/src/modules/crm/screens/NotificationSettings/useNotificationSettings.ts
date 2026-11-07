/**
 * Dữ liệu và thao tác của trang "Cài đặt thông báo" (T-41, FR-09, FR-01; Architecture 6.2).
 * Gộp: trạng thái thiết bị này (`usePushSubscription`), danh sách thiết bị của chính mình (`GET /push-subscriptions`),
 * thao tác bật/tắt thiết bị này và gỡ một thiết bị bất kỳ. Dữ liệu server do React Query giữ; state cục bộ chỉ cho thông báo/đang xử lý.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toApiError } from '@crm/api/http/crmErrors';
import { deletePushSubscription, fetchPushSubscriptions, type PushDevice, type PushRevokedDevice } from '@crm/api/http/pushApi';
import { pushKeys, usePushSubscription, type UsePushSubscriptionResult } from '@crm/hooks/usePushSubscription';
import { readPushSubscriptionId } from '../../../../pwa/pushStorage';

/** Số thiết bị tối đa mỗi người (khớp giới hạn của máy chủ, Architecture 5.6). */
export const MAX_PUSH_DEVICES = 3;

/** Khóa danh sách thiết bị: nằm dưới `pushKeys.all` nhưng KHÔNG trùng tiền tố `pushKeys.device` (nên không bị làm tươi lẫn nhau). */
export const pushDeviceListKey = [...pushKeys.all, 'subscriptions'] as const;

/** Thông báo "Đã gỡ X để nhường chỗ" từ các thiết bị bị thu hồi vì vượt giới hạn (các lý do khác không cần báo). */
export const buildDisplacedNotices = (revoked: readonly PushRevokedDevice[]): string[] =>
  revoked.filter((item) => item.reason === 'LIMIT_EXCEEDED').map((item) => `Đã gỡ ${item.deviceLabel} để nhường chỗ (tối đa ${MAX_PUSH_DEVICES} thiết bị).`);

export interface UseNotificationSettingsResult {
  push: UsePushSubscriptionResult;
  devices: PushDevice[];
  /** Id đăng ký của THIẾT BỊ NÀY (nếu có) để đánh dấu "Thiết bị này" trong danh sách. */
  currentDeviceId: string | null;
  displacedNotices: string[];
  isDevicesLoading: boolean;
  devicesError: string | null;
  retryDevices: () => void;
  /** Thiết bị đang gỡ (để khóa nút), hoặc `null`. */
  removingDeviceId: string | null;
  /** Lỗi của lần gỡ thiết bị gần nhất. */
  actionMessage: string | null;
  /** Gọi TRỰC TIẾP trong handler bấm nút (xin quyền thông báo cần cử chỉ người dùng). */
  enableThisDevice: () => Promise<void>;
  disableThisDevice: () => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
}

export const useNotificationSettings = (): UseNotificationSettingsResult => {
  const queryClient = useQueryClient();
  const push = usePushSubscription();
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const devicesQuery = useQuery({
    queryKey: pushDeviceListKey,
    queryFn: ({ signal }) => fetchPushSubscriptions(signal),
    retry: false, // đã có nút "Thử lại"; không để khung chờ kéo dài khi lỗi
  });

  const refreshDevices = useCallback(() => queryClient.invalidateQueries({ queryKey: pushDeviceListKey }), [queryClient]);

  const enableThisDevice = useCallback(async () => {
    setActionMessage(null);
    // Thiết bị bị nhường chỗ (nếu có) hiện qua `recentlyRevoked` của danh sách sau khi làm tươi.
    await push.enable();
    await refreshDevices();
  }, [push, refreshDevices]);

  const disableThisDevice = useCallback(async () => {
    setActionMessage(null);
    await push.disable();
    await refreshDevices();
  }, [push, refreshDevices]);

  const removeDevice = useCallback(
    async (deviceId: string) => {
      setRemovingDeviceId(deviceId);
      setActionMessage(null);
      try {
        // Gỡ chính thiết bị này thì đi đường `disable` (hủy cả đăng ký ở trình duyệt, nếu không nút vẫn báo đang bật).
        if (deviceId === readPushSubscriptionId()) await push.disable();
        else await deletePushSubscription(deviceId);
      } catch (caught) {
        setActionMessage(toApiError(caught).message);
      } finally {
        setRemovingDeviceId(null);
        await refreshDevices();
      }
    },
    [push, refreshDevices],
  );

  return {
    push,
    devices: devicesQuery.data?.active ?? [],
    currentDeviceId: readPushSubscriptionId(),
    displacedNotices: buildDisplacedNotices(devicesQuery.data?.recentlyRevoked ?? []),
    isDevicesLoading: devicesQuery.isLoading,
    devicesError: devicesQuery.isError ? toApiError(devicesQuery.error).message : null,
    retryDevices: () => void devicesQuery.refetch(),
    removingDeviceId,
    actionMessage,
    enableThisDevice,
    disableThisDevice,
    removeDevice,
  };
};
