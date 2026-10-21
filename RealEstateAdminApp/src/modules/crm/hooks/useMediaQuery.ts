import { useCallback, useSyncExternalStore } from 'react';

const canUseMatchMedia = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Theo dõi 1 media query, tự cập nhật khi viewport đổi.
 * - Dùng useSyncExternalStore -> không tearing, không cần useEffect + setState.
 * - SSR / môi trường không có matchMedia: trả `serverFallback`.
 */
export const useMediaQuery = (query: string, serverFallback = false): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canUseMatchMedia()) return () => undefined;
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener('change', onChange);
      return () => mediaQueryList.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = () => (canUseMatchMedia() ? window.matchMedia(query).matches : serverFallback);
  const getServerSnapshot = () => serverFallback;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
