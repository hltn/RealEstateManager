import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "settings" (Cài đặt CRM — chỉ Quản trị): chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const SettingsScreen = createResponsiveScreen(
  {
    desktop: () => import('./Settings.desktop'),
    mobile: () => import('./Settings.mobile'),
  },
  'SettingsScreen',
);

export default SettingsScreen;
