/**
 * Xử lý payload Web Push ở service worker (T-39, FR-09; hợp đồng Architecture 4.1 và 6.2).
 * File thuần: không phụ thuộc DOM/Workbox/`self` nên vitest kiểm được, và nằm trong `include` của tsconfig.sw.json.
 */

/** Tiêu đề dự phòng khi payload sai định dạng (lưới an toàn kỹ thuật, KHÔNG phải mẫu thứ năm của danh mục push; Q12). */
export const FALLBACK_PUSH_TITLE = 'Bạn có thông báo mới';

/** Icon thông báo (public/pwa-192x192.png, đã có trong bản dựng). */
export const PUSH_ICON_URL = '/pwa-192x192.png';

/** Trang đích khi `url` thiếu hoặc không hợp lệ. */
export const DEFAULT_PUSH_URL = '/';

const MAX_URL_LENGTH = 2048;
const MAX_TAG_LENGTH = 256;
/** Ký tự điều khiển, khoảng trắng và dấu `\` (trình duyệt coi `\` như `/` nên `/\host` có thể thành `//host`). */
const hasForbiddenUrlChar = (url: string): boolean =>
  Array.from(url).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || char === '\\';
  });

/** Payload đã chuẩn hóa, luôn đủ `title`, `body`, `url` để gọi `showNotification` (không bao giờ push im lặng). */
export interface ParsedPushPayload {
  title: string;
  body: string;
  /** Luôn là đường dẫn nội bộ bắt đầu bằng `/`. */
  url: string;
  /** Id thông báo; cùng `tag` thì thông báo mới thay thế bản cũ. */
  tag?: string;
  type?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNonEmptyString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
};

/**
 * Chuẩn hóa `url` của thông báo: chỉ chấp nhận đường dẫn nội bộ (bắt đầu `/`, không `//`, không `\`, không ký tự điều khiển/khoảng trắng,
 * không chạm `/api`). Mọi trường hợp khác (URL tuyệt đối, `javascript:`, thiếu, không phải chuỗi) trả về `/`.
 */
export const normalizeInternalUrl = (rawUrl: unknown): string => {
  if (typeof rawUrl !== 'string') return DEFAULT_PUSH_URL;
  const url = rawUrl.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return DEFAULT_PUSH_URL;
  if (!url.startsWith('/') || url.startsWith('//') || hasForbiddenUrlChar(url)) return DEFAULT_PUSH_URL;
  // `/api` và `/api/...` là backend (ràng buộc PT-030: service worker không chạm), không phải trang để mở.
  if (url === '/api' || /^\/api[/?#]/.test(url)) return DEFAULT_PUSH_URL;
  return url;
};

/** Payload dự phòng khi dữ liệu push rỗng, không phải JSON hoặc không phải object. */
const buildFallbackPayload = (): ParsedPushPayload => ({ title: FALLBACK_PUSH_TITLE, body: '', url: DEFAULT_PUSH_URL });

/**
 * Đọc chuỗi JSON `{ title, body, url, tag, type }` từ sự kiện push. Không bao giờ ném lỗi:
 * sai định dạng thì trả nội dung chung `Bạn có thông báo mới`; thiếu `title` thì dùng tiêu đề chung nhưng giữ `body`/`url` hợp lệ.
 */
export const parsePushPayload = (rawText: string | null | undefined): ParsedPushPayload => {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) return buildFallbackPayload();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return buildFallbackPayload();
  }
  if (!isRecord(parsed)) return buildFallbackPayload();

  return {
    title: toNonEmptyString(parsed.title, 200) ?? FALLBACK_PUSH_TITLE,
    body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
    url: normalizeInternalUrl(parsed.url),
    tag: toNonEmptyString(parsed.tag, MAX_TAG_LENGTH),
    type: toNonEmptyString(parsed.type, 64),
  };
};
