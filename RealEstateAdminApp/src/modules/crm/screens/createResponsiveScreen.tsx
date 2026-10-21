import { lazy, Suspense, type ComponentType } from 'react';
import { useIsMobile } from '@crm/hooks/useIsMobile';
import { ScreenSkeleton } from './ScreenSkeleton';

type ScreenModule = { default: ComponentType };

interface ResponsiveScreenLoaders {
  desktop: () => Promise<ScreenModule>;
  mobile: () => Promise<ScreenModule>;
}

/**
 * Tạo component màn hình chọn biến thể theo `useIsMobile()`.
 * Mỗi biến thể được lazy-load -> thiết bị chỉ tải code của biến thể mình dùng.
 */
export const createResponsiveScreen = (loaders: ResponsiveScreenLoaders, displayName: string): ComponentType => {
  const DesktopVariant = lazy(loaders.desktop);
  const MobileVariant = lazy(loaders.mobile);

  const ResponsiveScreen = () => {
    const isMobile = useIsMobile();
    return (
      <Suspense fallback={<ScreenSkeleton variant={isMobile ? 'mobile' : 'desktop'} />}>
        {isMobile ? <MobileVariant /> : <DesktopVariant />}
      </Suspense>
    );
  };
  ResponsiveScreen.displayName = displayName;
  return ResponsiveScreen;
};
