import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "edit_persona": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const EditPersonaScreen = createResponsiveScreen(
  {
    desktop: () => import('./EditPersona.desktop'),
    mobile: () => import('./EditPersona.mobile'),
  },
  'EditPersonaScreen',
);

export default EditPersonaScreen;
