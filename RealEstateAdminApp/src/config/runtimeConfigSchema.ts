/**
 * Allowlist khóa + bộ kiểm giá trị của cấu hình FE lúc chạy (FR-15). MODULE THUẦN: không `window`, không DOM, không Node,
 * để dùng chung ở hai nơi mà không lệch nhau:
 *  - `runtimeConfig.ts`: lọc `window.__APP_CONFIG__` ở trình duyệt;
 *  - `devRuntimeConfig.ts` (plugin Vite dev, chạy trong Node): sinh `/env.js` từ `.env` gốc.
 * Thêm/bớt khóa cờ chỉ sửa MỘT chỗ ở đây (kiểu `RuntimeConfig` ở `runtimeConfig.ts` buộc phải khớp lúc biên dịch).
 */

/** Khóa kiểu boolean (allowlist). Mặc định mọi khóa `false`. */
export const RUNTIME_BOOLEAN_KEYS = [
  'CRM_ENABLED',
  'CRM_ATTACHMENTS_ENABLED',
  'CRM_PUSH_ENABLED',
  'CRM_IMPORT_ENABLED',
  'CRM_FEATURE_ZALO_ZNS',
  'CRM_FEATURE_IN_APP_CALL',
  'CRM_FEATURE_APPOINTMENT_SYNC',
  'CRM_MOCK_REPORTS',
  'CRM_MOCK_IMPORT_EXPORT',
] as const;

export type RuntimeBooleanKey = (typeof RUNTIME_BOOLEAN_KEYS)[number];

/** Tên khóa trong `/env.js` cho base URL backend (trùng tên biến env). */
export const API_URL_KEY = 'API_URL';
/** Tên khóa trong `/env.js` cho địa chỉ web công khai (camelCase; nguồn là biến env `FRONTEND_URL`). */
export const APP_URL_KEY = 'appUrl';

export const DEFAULT_API_URL = '/api/v1';

/** Ký tự bị cấm trong URL cấu hình (khoảng trắng, nháy, `<>`, `\`): chặn chèn chuỗi lạ vào chỗ dùng URL. */
const SAFE_URL_TAIL = String.raw`[^\s"'<>\\]+`;
/** `API_URL`: đường dẫn tương đối bắt đầu bằng `/` (không `//`) hoặc URL tuyệt đối http(s). */
const API_URL_PATTERN = new RegExp(String.raw`^(?:https?://${SAFE_URL_TAIL}|/(?!/)[^\s"'<>\\]*)$`);
/** `appUrl`: chỉ URL tuyệt đối http(s). */
const APP_URL_PATTERN = new RegExp(String.raw`^https?://${SAFE_URL_TAIL}$`);

/** Chỉ `true`/`false` (boolean hoặc chuỗi đúng `'true'`/`'false'`) hợp lệ; còn lại là `undefined` (rơi về mặc định). */
export const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

/** Chuỗi khớp mẫu (sau khi cắt khoảng trắng hai đầu) thì trả chuỗi đã cắt, ngược lại `undefined`. */
const parseUrl = (value: unknown, pattern: RegExp): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : undefined;
};

/** `API_URL` hợp lệ (đã cắt khoảng trắng) hoặc `undefined`. */
export const parseApiUrl = (value: unknown): string | undefined => parseUrl(value, API_URL_PATTERN);

/** `appUrl` hợp lệ (đã cắt khoảng trắng) hoặc `undefined`. */
export const parseAppUrl = (value: unknown): string | undefined => parseUrl(value, APP_URL_PATTERN);
