import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "appointments": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const AppointmentsScreen = createResponsiveScreen(
  {
    desktop: () => import('./Appointments.desktop'),
    mobile: () => import('./Appointments.mobile'),
  },
  'AppointmentsScreen',
);

export default AppointmentsScreen;
