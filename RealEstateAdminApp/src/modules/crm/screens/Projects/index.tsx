import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "projects": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const ProjectsScreen = createResponsiveScreen(
  {
    desktop: () => import('./Projects.desktop'),
    mobile: () => import('./Projects.mobile'),
  },
  'ProjectsScreen',
);

export default ProjectsScreen;
