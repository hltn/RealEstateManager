import { MOBILE_MEDIA_QUERY } from './breakpoints';
import { useMediaQuery } from './useMediaQuery';

/**
 * true khi viewport < 768px (dưới `md`) -> dùng giao diện APP (TopAppBar + BottomNavBar).
 * SSR: mặc định false (giao diện WEB).
 */
export const useIsMobile = (): boolean => useMediaQuery(MOBILE_MEDIA_QUERY, false);
