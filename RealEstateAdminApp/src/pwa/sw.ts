/// <reference lib="webworker" />
/**
 * Service worker của STND (PT-030) — dựng bằng vite-plugin-pwa (strategies: injectManifest).
 *
 * Phạm vi cố ý hẹp: app CÀI ĐƯỢC nhưng KHÔNG chạy offline với dữ liệu.
 *  - Precache chỉ vỏ app (JS/CSS/icon/offline.html; danh sách do plugin chèn vào `self.__WB_MANIFEST`).
 *  - Điều hướng (mở trang) luôn đi mạng; chỉ khi mất mạng mới trả offline.html tĩnh. KHÔNG trả bản HTML/dữ liệu cũ.
 *  - KHÔNG có runtimeCaching cho /api, ảnh hay origin khác; request không khớp route nào đều đi thẳng ra mạng.
 *  - Bản mới KHÔNG tự kích hoạt: chờ người dùng bấm "Cập nhật" (trang gửi message SKIP_WAITING).
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { filterPrecacheEntries, NAVIGATION_DENYLIST, OFFLINE_FALLBACK_URL } from './serviceWorkerConfig';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

cleanupOutdatedCaches();
// index.html KHÔNG nằm trong precache nên Workbox không có bản nào để trả cho "/" hay các route SPA.
precacheAndRoute(filterPrecacheEntries(self.__WB_MANIFEST));

/** Điều hướng: mạng trước; mạng hỏng (offline) thì hiện trang offline tĩnh với nút Thử lại. */
const handleNavigation = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    return await fetch(request);
  } catch {
    const offlinePage = await matchPrecache(OFFLINE_FALLBACK_URL);
    return offlinePage ?? Response.error();
  }
};

registerRoute(new NavigationRoute(handleNavigation, { denylist: [...NAVIGATION_DENYLIST] }));

// Trang gửi SKIP_WAITING khi người dùng đồng ý cập nhật (virtual:pwa-register -> updateSW(true)).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

clientsClaim();
