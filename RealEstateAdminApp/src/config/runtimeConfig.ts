/**
 * Cấu hình FE đọc LÚC CHẠY (FR-15), thay cho `import.meta.env.VITE_*` (vốn bị "đóng cứng" vào bundle lúc build).
 * NGUỒN DUY NHẤT: chỉ file này được đọc `window.__APP_CONFIG__`; mọi nơi khác import `runtimeConfig`.
 *
 * Luồng: `index.html` nạp `/env.js` (script thường, chạy trước app) -> `/env.js` gán `window.__APP_CONFIG__ = {...}`
 * (production: entrypoint nginx sinh từ env của container; dev: plugin Vite phục vụ từ `.env` gốc) -> module này đọc MỘT LẦN
 * khi nạp (cấu hình là hằng số của phiên tải trang).
 *
 * Quy tắc an toàn:
 * - Allowlist khóa: khóa lạ trong `window.__APP_CONFIG__` bị bỏ.
 * - Mặc định mọi cờ `false`; `API_URL` mặc định `/api/v1`; `appUrl` mặc định rỗng (= dùng `window.location.origin`).
 * - Giá trị sai kiểu/sai định dạng rơi về mặc định (không ném lỗi, không làm trắng trang).
 */

import {
  API_URL_KEY,
  APP_URL_KEY,
  DEFAULT_API_URL,
  parseApiUrl,
  parseAppUrl,
  parseBoolean,
  RUNTIME_BOOLEAN_KEYS,
  type RuntimeBooleanKey,
} from './runtimeConfigSchema';

export { DEFAULT_API_URL };

/** Cấu hình FE sau khi lọc allowlist + kiểm kiểu. Tên cờ trùng tên biến env mới (xem Architecture mục 3). */
export interface RuntimeConfig {
  /** Base URL backend. Mặc định `/api/v1` (cùng origin, nginx proxy). */
  readonly API_URL: string;
  /** Địa chỉ web công khai của app (hiển thị ở nút cài app). Rỗng = dùng `window.location.origin`. */
  readonly appUrl: string;
  /** Bật module CRM (route `/crm/*`, menu "Quản lý khách hàng"). */
  readonly CRM_ENABLED: boolean;
  /** Ảnh đính kèm nhật ký (khớp cờ backend). */
  readonly CRM_ATTACHMENTS_ENABLED: boolean;
  /** Thông báo đẩy (khớp cờ backend). */
  readonly CRM_PUSH_ENABLED: boolean;
  /** Nhập khách hàng từ file (khớp cờ backend). */
  readonly CRM_IMPORT_ENABLED: boolean;
  /** Z2: gửi tin Zalo ZNS/OA từ ứng dụng. */
  readonly CRM_FEATURE_ZALO_ZNS: boolean;
  /** R2: gọi khách qua ứng dụng. */
  readonly CRM_FEATURE_IN_APP_CALL: boolean;
  /** Tự gửi SMS/ZNS xác nhận lịch hẹn + đồng bộ lịch. */
  readonly CRM_FEATURE_APPOINTMENT_SYNC: boolean;
  /** Màn Báo cáo chạy trên dữ liệu mẫu (chưa có API dashboard). */
  readonly CRM_MOCK_REPORTS: boolean;
  /** Nhập/xuất file chạy trên dữ liệu mẫu (chưa có API import/export). */
  readonly CRM_MOCK_IMPORT_EXPORT: boolean;
}

declare global {
  interface Window {
    /** Do `/env.js` gán; đọc qua `runtimeConfig`, không truy cập trực tiếp ở nơi khác. */
    __APP_CONFIG__?: unknown;
  }
}

/** Mặc định an toàn: mọi cờ tắt, `API_URL=/api/v1`, `appUrl` rỗng. */
const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = Object.freeze({
  API_URL: DEFAULT_API_URL,
  appUrl: '',
  CRM_ENABLED: false,
  CRM_ATTACHMENTS_ENABLED: false,
  CRM_PUSH_ENABLED: false,
  CRM_IMPORT_ENABLED: false,
  CRM_FEATURE_ZALO_ZNS: false,
  CRM_FEATURE_IN_APP_CALL: false,
  CRM_FEATURE_APPOINTMENT_SYNC: false,
  CRM_MOCK_REPORTS: false,
  CRM_MOCK_IMPORT_EXPORT: false,
});

/**
 * Lọc dữ liệu thô (thường là `window.__APP_CONFIG__`) thành `RuntimeConfig`: chỉ giữ khóa allowlist,
 * giá trị sai kiểu/định dạng rơi về mặc định. Hàm thuần để test độc lập với `window`.
 */
export const parseRuntimeConfig = (raw: unknown): RuntimeConfig => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_RUNTIME_CONFIG;
  const source = raw as Record<string, unknown>;

  const flags = Object.fromEntries(
    RUNTIME_BOOLEAN_KEYS.map((key) => [key, parseBoolean(source[key]) ?? DEFAULT_RUNTIME_CONFIG[key]]),
  ) as Pick<RuntimeConfig, RuntimeBooleanKey>;

  return Object.freeze({
    ...flags,
    API_URL: parseApiUrl(source[API_URL_KEY]) ?? DEFAULT_API_URL,
    appUrl: parseAppUrl(source[APP_URL_KEY]) ?? '',
  });
};

/** Cấu hình lúc chạy, đọc một lần khi nạp module (`typeof window` để an toàn ngoài trình duyệt). */
export const runtimeConfig: RuntimeConfig = parseRuntimeConfig(
  typeof window === 'undefined' ? undefined : window.__APP_CONFIG__,
);
