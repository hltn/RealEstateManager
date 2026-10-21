import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "customer_detail": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const CustomerDetailScreen = createResponsiveScreen(
  {
    desktop: () => import('./CustomerDetail.desktop'),
    mobile: () => import('./CustomerDetail.mobile'),
  },
  'CustomerDetailScreen',
);

export default CustomerDetailScreen;
