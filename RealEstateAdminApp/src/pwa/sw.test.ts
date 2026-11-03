import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Kiểm chính file service worker `sw.ts` (không chỉ hằng số trong serviceWorkerConfig): nó thực sự nối denylist /api,
 * lọc manifest khỏi precache, xử lý SKIP_WAITING và chỉ trả offline.html khi MẠNG hỏng.
 * sw.ts chạy ngay khi import và dùng `self` kiểu ServiceWorkerGlobalScope (ngoài tsconfig.app) nên:
 *  - nạp bằng import động qua biến (TypeScript của app không kéo sw.ts vào chương trình);
 *  - mock workbox-core/precaching; giữ workbox-routing thật (NavigationRoute thật), chỉ chặn registerRoute.
 */
const { registerRouteMock, precacheAndRouteMock, cleanupOutdatedCachesMock, matchPrecacheMock, clientsClaimMock } = vi.hoisted(() => ({
  registerRouteMock: vi.fn(),
  precacheAndRouteMock: vi.fn(),
  cleanupOutdatedCachesMock: vi.fn(),
  matchPrecacheMock: vi.fn(),
  clientsClaimMock: vi.fn(),
}));

vi.mock('workbox-core', () => ({ clientsClaim: clientsClaimMock }));
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: precacheAndRouteMock,
  cleanupOutdatedCaches: cleanupOutdatedCachesMock,
  matchPrecache: matchPrecacheMock,
}));
vi.mock('workbox-routing', async (importOriginal) => ({ ...(await importOriginal<typeof import('workbox-routing')>()), registerRoute: registerRouteMock }));

interface NavigationRouteLike {
  match: (options: { request: { mode: string }; url: URL; sameOrigin: boolean; event: unknown }) => unknown;
  handler: { handle: (options: { request: Request; url: URL; event: unknown }) => Promise<Response> };
}

type MessageListener = (event: { data?: { type?: string } }) => void;

const SW_MODULE_PATH = './sw.ts';
const ORIGIN = 'https://stnd.example';

describe('service worker (sw.ts)', () => {
  const skipWaiting = vi.fn();
  let messageListener: MessageListener | undefined;

  const loadServiceWorker = async (manifest: Array<string | { url: string; revision: string | null }>) => {
    (self as unknown as { __WB_MANIFEST: unknown }).__WB_MANIFEST = manifest;
    await import(/* @vite-ignore */ SW_MODULE_PATH);
    const route = registerRouteMock.mock.calls[0]?.[0] as NavigationRouteLike | undefined;
    return { route };
  };

  const matchNavigation = (route: NavigationRouteLike, path: string, mode = 'navigate') =>
    Boolean(route.match({ request: { mode }, url: new URL(path, ORIGIN), sameOrigin: true, event: undefined }));

  const handleNavigation = (route: NavigationRouteLike, path = '/crm/today') =>
    route.handler.handle({ request: new Request(new URL(path, ORIGIN)), url: new URL(path, ORIGIN), event: undefined });

  beforeEach(() => {
    vi.resetModules();
    registerRouteMock.mockReset();
    precacheAndRouteMock.mockReset();
    cleanupOutdatedCachesMock.mockReset();
    matchPrecacheMock.mockReset();
    clientsClaimMock.mockReset();
    skipWaiting.mockReset();
    messageListener = undefined;
    (self as unknown as { skipWaiting: () => void }).skipWaiting = skipWaiting;
    vi.spyOn(self, 'addEventListener').mockImplementation(((type: string, listener: MessageListener) => {
      if (type === 'message') messageListener = listener;
    }) as typeof self.addEventListener);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(self, 'skipWaiting');
    Reflect.deleteProperty(self, '__WB_MANIFEST');
  });

  it('precache chỉ vỏ app: lọc manifest.webmanifest, dọn cache cũ, chỉ đăng ký MỘT route (không runtimeCaching)', async () => {
    await loadServiceWorker([
      { url: 'assets/index-abc.js', revision: null },
      { url: 'manifest.webmanifest', revision: 'x' },
      { url: 'offline.html', revision: 'y' },
    ]);

    expect(cleanupOutdatedCachesMock).toHaveBeenCalledTimes(1);
    expect(precacheAndRouteMock).toHaveBeenCalledTimes(1);
    expect((precacheAndRouteMock.mock.calls[0][0] as Array<{ url: string }>).map((entry) => entry.url)).toEqual(['assets/index-abc.js', 'offline.html']);
    expect(registerRouteMock).toHaveBeenCalledTimes(1);
  });

  it('route điều hướng KHÔNG khớp /api/* (kể cả ảnh signed URL, callback) nhưng khớp route SPA; request không phải điều hướng không khớp', async () => {
    const { route } = await loadServiceWorker([]);
    expect(route).toBeDefined();

    expect(matchNavigation(route!, '/api/v1/crm/customers/1/attachments/abc')).toBe(false);
    expect(matchNavigation(route!, '/api/v1/auth/me?x=1')).toBe(false);
    expect(matchNavigation(route!, '/crm/today')).toBe(true);
    expect(matchNavigation(route!, '/login')).toBe(true);
    // fetch()/XHR/ảnh (mode khác navigate) không bao giờ bị route này chạm vào, kể cả GET/POST/PUT tới /api.
    expect(matchNavigation(route!, '/crm/today', 'cors')).toBe(false);
    expect(matchNavigation(route!, '/api/v1/auth/login', 'same-origin')).toBe(false);
  });

  it('điều hướng: mạng OK thì trả đúng phản hồi mạng (không dùng cache)', async () => {
    const networkResponse = new Response('<html>mới</html>', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(networkResponse));
    const { route } = await loadServiceWorker([]);

    await expect(handleNavigation(route!)).resolves.toBe(networkResponse);
    expect(matchPrecacheMock).not.toHaveBeenCalled();
  });

  it('điều hướng: lỗi HTTP 5xx từ máy chủ được trả nguyên (KHÔNG thay bằng offline.html — máy chủ lỗi ≠ mất mạng)', async () => {
    const serverError = new Response('bad gateway', { status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(serverError));
    const { route } = await loadServiceWorker([]);

    const response = await handleNavigation(route!);
    expect(response).toBe(serverError);
    expect(response.status).toBe(502);
    expect(matchPrecacheMock).not.toHaveBeenCalled();
  });

  it('điều hướng: mất mạng (fetch ném lỗi) thì trả offline.html từ precache', async () => {
    const offlinePage = new Response('offline', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    matchPrecacheMock.mockResolvedValue(offlinePage);
    const { route } = await loadServiceWorker([]);

    await expect(handleNavigation(route!)).resolves.toBe(offlinePage);
    expect(matchPrecacheMock).toHaveBeenCalledWith('/offline.html');
  });

  it('điều hướng: mất mạng mà thiếu offline.html trong precache thì trả lỗi mạng chuẩn (không treo, không trả HTML cũ)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    matchPrecacheMock.mockResolvedValue(undefined);
    const { route } = await loadServiceWorker([]);

    const response = await handleNavigation(route!);
    expect(response.type).toBe('error');
  });

  it('message SKIP_WAITING mới kích hoạt skipWaiting (để updateSW(true) hoạt động); message khác bị bỏ qua', async () => {
    await loadServiceWorker([]);
    expect(messageListener).toBeDefined();

    messageListener!({ data: { type: 'SOMETHING_ELSE' } });
    messageListener!({});
    messageListener!({ data: undefined });
    expect(skipWaiting).not.toHaveBeenCalled();

    messageListener!({ data: { type: 'SKIP_WAITING' } });
    expect(skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('không tự skipWaiting khi cài đặt (bản mới phải chờ người dùng bấm Cập nhật)', async () => {
    await loadServiceWorker([]);
    expect(skipWaiting).not.toHaveBeenCalled();
  });
});
