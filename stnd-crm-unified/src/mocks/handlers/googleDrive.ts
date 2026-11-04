import type { MockRoute } from '../types';
import { ok } from '../utils';

/** `/google-drive/*` — prototype mặc định CHƯA kết nối Google Drive. */
export const googleDriveRoutes: MockRoute[] = [
  { method: 'GET', pattern: /^\/google-drive\/status$/, handler: () => ok({ connected: false }) },
  {
    method: 'GET',
    pattern: /^\/google-drive\/auth\/url$/,
    handler: () => ok({ url: '#mock-google-oauth' }),
  },
  { method: 'DELETE', pattern: /^\/google-drive\/disconnect$/, handler: () => ok({ message: 'Đã ngắt kết nối' }) },
  {
    method: 'POST',
    pattern: /^\/google-drive\/folder\/validate$/,
    handler: () => ok({ valid: true, folderName: 'STND - Phân tích thị trường', folderId: 'mock-folder' }),
  },
  {
    method: 'POST',
    pattern: /^\/google-drive\/export\/([^/]+)$/,
    handler: ({ params }) =>
      ok({
        message: 'Đã xuất lên Google Drive (mock)',
        data: { documentId: `doc-${params[0]}`, documentUrl: '#mock-doc', title: 'Báo cáo phân tích thị trường' },
      }),
  },
];
