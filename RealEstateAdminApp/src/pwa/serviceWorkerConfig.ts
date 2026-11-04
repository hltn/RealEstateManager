/**
 * Hằng số dùng chung giữa service worker (src/pwa/sw.ts) và phần đăng ký ở trang.
 * Tách riêng, không phụ thuộc DOM/Workbox để vitest kiểm được các quy tắc an toàn (đặc biệt: không cache /api).
 */

/** Đường dẫn trang offline tĩnh (public/offline.html), được precache. */
export const OFFLINE_FALLBACK_URL = '/offline.html';

/**
 * Điều hướng (navigation request) KHÔNG được service worker chạm vào: mọi đường dẫn dưới /api/
 * (backend, ảnh signed URL, OAuth callback...). App có CCCD/hồ sơ khách nên tuyệt đối không để SW can thiệp/cache.
 */
export const NAVIGATION_DENYLIST: readonly RegExp[] = [/^\/api\//];

/** Chu kỳ kiểm tra bản mới khi app mở lâu (PWA standalone trên iOS gần như không tự tải lại trang): 1 giờ. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Có phải đường dẫn bị cấm xử lý bởi service worker (khớp NAVIGATION_DENYLIST). */
export const isDeniedNavigationPath = (pathname: string): boolean =>
  NAVIGATION_DENYLIST.some((pattern) => pattern.test(pathname));

/**
 * URL không được precache dù plugin tự thêm: manifest.webmanifest phải luôn lấy từ mạng
 * (precache là cache-first nên đổi tên/icon/màu sẽ bị kẹt bản cũ).
 */
const PRECACHE_EXCLUDED_URLS: readonly string[] = ['manifest.webmanifest'];

/** Lọc danh sách precache do plugin chèn (`self.__WB_MANIFEST`), bỏ các URL trong PRECACHE_EXCLUDED_URLS. */
export const filterPrecacheEntries = <T extends string | { url: string }>(entries: readonly T[]): T[] =>
  entries.filter((entry) => !PRECACHE_EXCLUDED_URLS.includes(typeof entry === 'string' ? entry : entry.url));
