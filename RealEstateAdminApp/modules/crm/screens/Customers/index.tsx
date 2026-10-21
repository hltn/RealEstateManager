import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "customers": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const CustomersScreen = createResponsiveScreen(
  {
    desktop: () => import('./Customers.desktop'),
    mobile: () => import('./Customers.mobile'),
  },
  'CustomersScreen',
);

export default CustomersScreen;
