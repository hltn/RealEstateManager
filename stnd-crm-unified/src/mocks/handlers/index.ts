import type { MockRoute } from '../types';
import { authRoutes } from './auth';
import { externalLogsRoutes } from './externalLogs';
import { googleDriveRoutes } from './googleDrive';
import { knowledgeArticlesRoutes } from './knowledgeArticles';
import { newsManagerRoutes } from './newsManager';
import { newsSourcesRoutes } from './newsSources';
import { settingsRoutes } from './settings';
import { usersRoutes } from './users';

/**
 * Bảng route mock — duyệt theo thứ tự, route đầu tiên khớp (method + regex) thắng.
 * Đặt route cụ thể (vd `/x/bulk/delete`) TRƯỚC route có tham số (`/x/:id`) trong từng file domain.
 */
export const mockRoutes: MockRoute[] = [
  ...authRoutes,
  ...googleDriveRoutes,
  ...usersRoutes,
  ...settingsRoutes,
  ...newsSourcesRoutes,
  ...newsManagerRoutes,
  ...knowledgeArticlesRoutes,
  ...externalLogsRoutes,
];
