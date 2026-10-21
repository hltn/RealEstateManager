import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "create_customer": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const CreateCustomerScreen = createResponsiveScreen(
  {
    desktop: () => import('./CreateCustomer.desktop'),
    mobile: () => import('./CreateCustomer.mobile'),
  },
  'CreateCustomerScreen',
);

export default CreateCustomerScreen;
