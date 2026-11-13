/**
 * Sinh `/env.js` cho Vite dev/preview (FR-15) từ biến môi trường (`.env` ở thư mục GỐC repo + `process.env`).
 * Đây là phần "thuần" của plugin trong `vite.config.ts` (chạy trong Node, không `window`): production dùng
 * entrypoint nginx (`40-runtime-config.sh`) với CÙNG allowlist và CÙNG luật kiểm giá trị (`runtimeConfigSchema.ts`).
 *
 * An toàn:
 * - CHỈ phát khóa allowlist (không bao giờ dump toàn bộ env, nên mật khẩu/secret trong `.env` không lọt ra trình duyệt).
 * - Giá trị sai/rỗng bị BỎ khỏi kết quả để FE rơi về mặc định (cờ `false`, `API_URL=/api/v1`, `appUrl` rỗng).
 */
import { API_URL_KEY, APP_URL_KEY, parseApiUrl, parseAppUrl, parseBoolean, RUNTIME_BOOLEAN_KEYS } from './runtimeConfigSchema.ts';

/** Nguồn biến môi trường (vd. kết quả `loadEnv`). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Đường dẫn phục vụ cấu hình lúc chạy. */
export const RUNTIME_CONFIG_PATH = '/env.js';

/** `appUrl` lấy từ biến env `FRONTEND_URL` (cùng quy ước với entrypoint nginx). */
export const APP_URL_ENV_NAME = 'FRONTEND_URL';

/** Chọn các khóa allowlist có giá trị hợp lệ từ env. Khóa không nằm trong allowlist không bao giờ xuất hiện. */
export const pickRuntimeConfig = (env: EnvSource): Record<string, boolean | string> => {
  const picked: Record<string, boolean | string> = {};
  for (const key of RUNTIME_BOOLEAN_KEYS) {
    const value = parseBoolean(env[key]);
    if (value !== undefined) picked[key] = value;
  }
  const apiUrl = parseApiUrl(env[API_URL_KEY]);
  if (apiUrl !== undefined) picked[API_URL_KEY] = apiUrl;
  const appUrl = parseAppUrl(env[APP_URL_ENV_NAME]);
  if (appUrl !== undefined) picked[APP_URL_KEY] = appUrl;
  return picked;
};

/** Nội dung `/env.js`: một câu lệnh gán `window.__APP_CONFIG__` (giá trị đã kiểm nên JSON.stringify là đủ an toàn). */
export const buildRuntimeConfigScript = (env: EnvSource): string => `window.__APP_CONFIG__ = ${JSON.stringify(pickRuntimeConfig(env))};\n`;

/** Phần tối thiểu của request/response Node mà handler dùng (để test bằng đối tượng giả, không kéo kiểu Node vào app). */
export interface RuntimeConfigRequest {
  method?: string;
  url?: string;
}
export interface RuntimeConfigResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => unknown;
  end: (body?: string) => unknown;
}

/**
 * Middleware Connect: GET/HEAD `/env.js` (bỏ qua query) trả cấu hình; mọi request khác chuyển tiếp `next()`.
 * `readEnv` được gọi MỖI request nên sửa `.env` có hiệu lực ngay khi tải lại trang. `Cache-Control: no-cache` như nginx.
 */
export const createRuntimeConfigMiddleware =
  (readEnv: () => EnvSource) =>
  (req: RuntimeConfigRequest, res: RuntimeConfigResponse, next: () => void): void => {
    const pathname = (req.url ?? '').split('?', 1)[0];
    const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
    if (pathname !== RUNTIME_CONFIG_PATH || !isReadMethod) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : buildRuntimeConfigScript(readEnv()));
  };
