/// <reference lib="webworker" />
/**
 * Service worker của STND (PT-030) — dựng bằng vite-plugin-pwa (strategies: injectManifest).
 *
 * Phạm vi cố ý hẹp: app CÀI ĐƯỢC nhưng KHÔNG chạy offline với dữ liệu.
 *  - Precache chỉ vỏ app (JS/CSS/icon/offline.html; danh sách do plugin chèn vào `self.__WB_MANIFEST`).
 *  - Điều hướng (mở trang) luôn đi mạng; chỉ khi mất mạng mới trả offline.html tĩnh. KHÔNG trả bản HTML/dữ liệu cũ.
 *  - KHÔNG có runtimeCaching cho /api, ảnh hay origin khác; request không khớp route nào đều đi thẳng ra mạng.
 *  - Bản mới KHÔNG tự kích hoạt: chờ người dùng bấm "Cập nhật" (trang gửi message SKIP_WAITING).
 *  - Web Push (T-39, FR-09): `push` luôn showNotification, `notificationclick` mở/focus đường dẫn nội bộ (logic thuần ở pushPayload.ts).
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { normalizeInternalUrl, parsePushPayload, PUSH_ICON_URL } from './pushPayload';
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

/** Đọc dữ liệu push dạng chuỗi; lỗi đọc thì coi như rỗng để vẫn hiện thông báo chung (không bao giờ ném lỗi). */
const readPushText = (data: PushMessageData | null): string | null => {
  try {
    return data?.text() ?? null;
  } catch {
    return null;
  }
};

/**
 * Push (FR-09): LUÔN gọi showNotification, kể cả payload hỏng (push im lặng bị iOS/Chrome phạt rồi thu hồi subscription).
 * `tag` = id thông báo để bản trùng thay thế nhau; `data.url` là đường dẫn nội bộ đã chuẩn hóa cho notificationclick.
 * Không fetch, không cache, không chạm /api (ràng buộc PT-030).
 */
self.addEventListener('push', (event) => {
  const { title, body, url, tag } = parsePushPayload(readPushText(event.data));
  event.waitUntil(self.registration.showNotification(title, { body, icon: PUSH_ICON_URL, tag, data: { url } }));
});

/** Chọn cửa sổ app đang mở để tái dùng: ưu tiên cửa sổ đang focus, rồi cửa sổ đang hiển thị, rồi cái đầu tiên. */
const pickClient = (windowClients: readonly WindowClient[]): WindowClient | undefined =>
  windowClients.find((client) => client.focused) ?? windowClients.find((client) => client.visibilityState === 'visible') ?? windowClients[0];

/** Mở/chuyển tới `url` nội bộ: có cửa sổ thì focus + navigate (focus trước vì iOS chỉ cho trong lúc xử lý thao tác bấm), không thì openWindow. */
const openNotificationTarget = async (url: string): Promise<void> => {
  const target = new URL(url, self.location.origin).href;
  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = pickClient(windowClients);
  if (existing) {
    try {
      await existing.focus();
      await existing.navigate(target);
      return;
    } catch {
      // Cửa sổ không còn/không do SW kiểm soát (navigate bị từ chối): rơi xuống mở cửa sổ mới.
    }
  }
  await self.clients.openWindow(target);
};

/** Bấm thông báo (FR-09): đóng thông báo, chỉ đi tới `data.url` nếu là đường dẫn nội bộ hợp lệ, sai thì về `/`. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const rawUrl = typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined;
  event.waitUntil(openNotificationTarget(normalizeInternalUrl(rawUrl)));
});

clientsClaim();
