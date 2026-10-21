import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "reports": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const ReportsScreen = createResponsiveScreen(
  {
    desktop: () => import('./Reports.desktop'),
    mobile: () => import('./Reports.mobile'),
  },
  'ReportsScreen',
);

export default ReportsScreen;
