import { useLocation } from 'react-router-dom';
import { parseCreateAppointmentCustomerId } from '@crm/routes';
import { createResponsiveScreen } from '../createResponsiveScreen';

const ResponsiveCreateAppointment = createResponsiveScreen(
  {
    desktop: () => import('./CreateAppointment.desktop'),
    mobile: () => import('./CreateAppointment.mobile'),
  },
  'CreateAppointmentScreen',
);

/**
 * Màn "create_appointment": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể).
 * `key` theo khách trong URL: đổi khách (vd Back/Forward giữa 2 lần đặt lịch) dựng form mới, không rò dữ liệu đã nhập cho khách khác.
 */
export const CreateAppointmentScreen = () => {
  const { search } = useLocation();
  return <ResponsiveCreateAppointment key={parseCreateAppointmentCustomerId(search) ?? 'none'} />;
};

export default CreateAppointmentScreen;
