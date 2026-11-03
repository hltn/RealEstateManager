import { registerSW } from 'virtual:pwa-register';
import { UPDATE_CHECK_INTERVAL_MS } from './serviceWorkerConfig';

/** Hàm gỡ timer/listener kiểm tra bản mới (gọi khi unmount / test). */
type DisposeServiceWorkerWatch = () => void;

const NOOP_DISPOSE: DisposeServiceWorkerWatch = () => {};

/**
 * Hỏi trình duyệt xem có sw.js mới không: khi app quay lại foreground (iOS standalone hiếm khi tải lại trang)
 * và định kỳ mỗi UPDATE_CHECK_INTERVAL_MS. Bỏ qua khi mất mạng.
 */
const watchForUpdates = (registration: ServiceWorkerRegistration): (() => void) => {
  const checkForUpdate = (): void => {
    if (!navigator.onLine) return;
    // update() lỗi mạng chỉ là chưa kiểm được lần này, không phải lỗi cần báo người dùng.
    void registration.update().catch(() => {});
  };
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') checkForUpdate();
  };

  const timerId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    window.clearInterval(timerId);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

/**
 * Đăng ký service worker (CHỈ ở bản production; dev/test trả handle rỗng).
 * Chế độ prompt: khi có bản mới gọi `onUpdateAvailable(applyUpdate)`, KHÔNG tự reload — người dùng có thể đang gõ dở ghi chú.
 */
export const registerServiceWorker = (onUpdateAvailable: (applyUpdate: () => Promise<void>) => void): DisposeServiceWorkerWatch => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return NOOP_DISPOSE;

  let stopWatching: (() => void) | undefined;
  let isDisposed = false;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => onUpdateAvailable(() => updateSW(true)),
    onRegisteredSW: (_swUrl, registration) => {
      if (registration && !isDisposed) stopWatching = watchForUpdates(registration);
    },
  });

  return () => {
    isDisposed = true;
    stopWatching?.();
  };
};
