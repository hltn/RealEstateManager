import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "edit_investment": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const EditInvestmentScreen = createResponsiveScreen(
  {
    desktop: () => import('./EditInvestment.desktop'),
    mobile: () => import('./EditInvestment.mobile'),
  },
  'EditInvestmentScreen',
);

export default EditInvestmentScreen;
