import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "deleted_customers" (Khách đã xóa — chỉ Quản trị): chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const DeletedCustomersScreen = createResponsiveScreen(
  {
    desktop: () => import('./DeletedCustomers.desktop'),
    mobile: () => import('./DeletedCustomers.mobile'),
  },
  'DeletedCustomersScreen',
);

export default DeletedCustomersScreen;
