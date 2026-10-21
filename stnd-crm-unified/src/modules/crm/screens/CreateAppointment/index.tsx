import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "create_appointment": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const CreateAppointmentScreen = createResponsiveScreen(
  {
    desktop: () => import('./CreateAppointment.desktop'),
    mobile: () => import('./CreateAppointment.mobile'),
  },
  'CreateAppointmentScreen',
);

export default CreateAppointmentScreen;
