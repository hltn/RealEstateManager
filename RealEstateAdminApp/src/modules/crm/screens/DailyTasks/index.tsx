import { createResponsiveScreen } from '../createResponsiveScreen';

/** Màn "today": chọn biến thể desktop/mobile theo useIsMobile (lazy-load từng biến thể). */
export const DailyTasksScreen = createResponsiveScreen(
  {
    desktop: () => import('./DailyTasks.desktop'),
    mobile: () => import('./DailyTasks.mobile'),
  },
  'DailyTasksScreen',
);

export default DailyTasksScreen;
