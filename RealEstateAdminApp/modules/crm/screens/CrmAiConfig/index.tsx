import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "ai_config" của CRM (khác màn AI Config của Admin): chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const CrmAiConfigScreen = createResponsiveScreen(
  {
    desktop: () => import('./CrmAiConfig.desktop'),
    mobile: () => import('./CrmAiConfig.mobile'),
  },
  'CrmAiConfigScreen',
);

export default CrmAiConfigScreen;
