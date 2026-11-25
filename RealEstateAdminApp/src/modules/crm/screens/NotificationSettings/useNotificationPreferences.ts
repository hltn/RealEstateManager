/**
 * Dữ liệu và thao tác "Loại thông báo" + "Giờ yên lặng" của trang Cài đặt thông báo (T-42, FR-10, FR-43; Architecture 6.2).
 * Server state do React Query giữ. Lưu theo kiểu optimistic: cập nhật cache trước, lỗi thì hoàn tác ĐÚNG phần vừa đổi
 * (không chép lại cả bản chụp, để nhiều công tắc bấm liên tiếp không ghi đè nhau). `PUT` chỉ gửi loại vừa đổi.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toApiError } from '@crm/api/http/crmErrors';
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
  type QuietHours,
  type TypePreference,
} from '@crm/api/http/notificationPreferencesApi';

export const notificationPreferencesKey = ['notification-preferences', 'me'] as const;
const saveMutationKey = ['notification-preferences', 'save'] as const;

/** Mặc định của loại chưa lưu (máy chủ cũng trả đủ mọi loại; đây chỉ là lưới an toàn). */
const DEFAULT_TYPE_PREFERENCE: TypePreference = { push: true, inApp: true };

export interface UseNotificationPreferencesResult {
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  loadError: string | null;
  retry: () => void;
  /** Lỗi của lần lưu gần nhất (đã hoàn tác giao diện); xóa khi lưu thành công. */
  saveError: string | null;
  isSavingQuietHours: boolean;
  setTypePush: (type: string, isPushEnabled: boolean) => void;
  /** Lưu giờ yên lặng; `null` = tắt. Trả `true` nếu lưu được. */
  saveQuietHours: (quietHours: QuietHours | null) => Promise<boolean>;
}

export const useNotificationPreferences = (): UseNotificationPreferencesResult => {
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: notificationPreferencesKey,
    queryFn: ({ signal }) => fetchNotificationPreferences(signal),
    retry: false, // đã có nút "Thử lại"
  });

  /** Ghi đè một phần của cache hiện tại (không đụng phần khác). */
  const patchCache = (patch: (current: NotificationPreferences) => NotificationPreferences) => {
    queryClient.setQueryData<NotificationPreferences>(notificationPreferencesKey, (current) => (current ? patch(current) : current));
  };

  /** Lưu xong (đúng hay sai) mà không còn lần lưu nào khác đang chạy thì đồng bộ lại với máy chủ (chặn lệch khi bấm liên tiếp). */
  const resyncWhenIdle = () => {
    // Trong `onSettled` lần lưu hiện tại vẫn còn được đếm là đang chạy.
    if (queryClient.isMutating({ mutationKey: saveMutationKey }) <= 1) void queryClient.invalidateQueries({ queryKey: notificationPreferencesKey });
  };

  const typeMutation = useMutation({
    mutationKey: saveMutationKey,
    mutationFn: ({ type, next }: { type: string; next: TypePreference }) => updateNotificationPreferences({ types: { [type]: next } }),
    onMutate: async ({ type, next }) => {
      await queryClient.cancelQueries({ queryKey: notificationPreferencesKey });
      const previous = queryClient.getQueryData<NotificationPreferences>(notificationPreferencesKey)?.types[type] ?? DEFAULT_TYPE_PREFERENCE;
      setSaveError(null);
      patchCache((current) => ({ ...current, types: { ...current.types, [type]: next } }));
      return { previous };
    },
    onError: (error, { type }, context) => {
      setSaveError(toApiError(error).message);
      // Hoàn tác riêng loại này về giá trị trước khi bấm.
      if (context) patchCache((current) => ({ ...current, types: { ...current.types, [type]: context.previous } }));
    },
    onSettled: resyncWhenIdle,
  });

  // Giờ yên lặng KHÔNG cập nhật cache trước: bản nháp ở form đã là giao diện "tức thì"; lỗi thì bản nháp còn nguyên để thử lại.
  const quietHoursMutation = useMutation({
    mutationKey: saveMutationKey,
    mutationFn: (quietHours: QuietHours | null) => updateNotificationPreferences({ types: {}, quietHours }),
    onMutate: () => setSaveError(null),
    onSuccess: (saved) => patchCache((current) => ({ ...current, quietHours: saved.quietHours })),
    onError: (error) => setSaveError(toApiError(error).message),
    onSettled: resyncWhenIdle,
  });

  const setTypePush = (type: string, isPushEnabled: boolean) => {
    const current = query.data?.types[type] ?? DEFAULT_TYPE_PREFERENCE;
    // Gửi kèm `inApp` hiện có vì máy chủ yêu cầu đủ cặp `push` + `inApp` cho mỗi loại.
    typeMutation.mutate({ type, next: { push: isPushEnabled, inApp: current.inApp } });
  };

  const saveQuietHours = async (quietHours: QuietHours | null): Promise<boolean> => {
    try {
      await quietHoursMutation.mutateAsync(quietHours);
      return true;
    } catch {
      return false; // lỗi đã được `onError` ghi vào `saveError`
    }
  };

  return {
    preferences: query.data ?? null,
    isLoading: query.isLoading,
    loadError: query.isError ? toApiError(query.error).message : null,
    retry: () => void query.refetch(),
    saveError,
    isSavingQuietHours: quietHoursMutation.isPending,
    setTypePush,
    saveQuietHours,
  };
};
