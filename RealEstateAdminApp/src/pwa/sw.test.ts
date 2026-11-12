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
type AnyListener = (event: unknown) => void;

/** Giả lập `WindowClient` (chỉ phần SW dùng: focused, visibilityState, focus, navigate). */
interface FakeWindowClient {
  focused: boolean;
  visibilityState: 'visible' | 'hidden';
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

const SW_MODULE_PATH = './sw.ts';
const ORIGIN = 'https://stnd.example';

describe('service worker (sw.ts)', () => {
  const skipWaiting = vi.fn();
  const showNotification = vi.fn();
  const matchAll = vi.fn();
  const openWindow = vi.fn();
  let messageListener: MessageListener | undefined;
  let listeners: Record<string, AnyListener | undefined> = {};

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
    showNotification.mockReset().mockResolvedValue(undefined);
    matchAll.mockReset().mockResolvedValue([]);
    openWindow.mockReset().mockResolvedValue(null);
    messageListener = undefined;
    listeners = {};
    (self as unknown as { skipWaiting: () => void }).skipWaiting = skipWaiting;
    Object.defineProperty(self, 'registration', { value: { showNotification }, configurable: true, writable: true });
    Object.defineProperty(self, 'clients', { value: { matchAll, openWindow }, configurable: true, writable: true });
    vi.spyOn(self, 'addEventListener').mockImplementation(((type: string, listener: AnyListener) => {
      listeners[type] = listener;
      if (type === 'message') messageListener = listener as MessageListener;
    }) as typeof self.addEventListener);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(self, 'skipWaiting');
    Reflect.deleteProperty(self, 'registration');
    Reflect.deleteProperty(self, 'clients');
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

  describe('Web Push (T-39, FR-09)', () => {
    const NOTIFICATION_ICON = '/pwa-192x192.png';
    const targetOf = (path: string) => new URL(path, self.location.origin).href;

    /** Sự kiện `push` giả: `data = null` là push không kèm dữ liệu; đợi mọi promise đã đưa vào waitUntil. */
    const dispatchPush = async (data: { text: () => string } | null) => {
      await loadServiceWorker([]);
      const pending: Array<Promise<unknown>> = [];
      const waitUntil = vi.fn((promise: Promise<unknown>) => void pending.push(promise));
      listeners.push!({ data, waitUntil });
      await Promise.all(pending);
      return { waitUntil };
    };
    const pushText = (text: string) => ({ text: () => text });

    const dispatchClick = async (notificationData: unknown, windowClients: FakeWindowClient[] = []) => {
      await loadServiceWorker([]);
      matchAll.mockResolvedValue(windowClients);
      const close = vi.fn();
      const pending: Array<Promise<unknown>> = [];
      const waitUntil = vi.fn((promise: Promise<unknown>) => void pending.push(promise));
      listeners.notificationclick!({ notification: { close, data: notificationData }, waitUntil });
      await Promise.all(pending);
      return { close, waitUntil };
    };

    const createWindowClient = (overrides: Partial<FakeWindowClient> = {}): FakeWindowClient => ({
      focused: false,
      visibilityState: 'hidden',
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('FR-09: đăng ký trình xử lý push và notificationclick', async () => {
      await loadServiceWorker([]);

      expect(listeners.push).toBeTypeOf('function');
      expect(listeners.notificationclick).toBeTypeOf('function');
    });

    it('FR-09: push hợp lệ gọi showNotification đúng title/body/icon, tag = id thông báo, data.url nội bộ, bọc trong waitUntil', async () => {
      const { waitUntil } = await dispatchPush(
        pushText(JSON.stringify({ title: 'Lịch hẹn mới', body: 'Nguyễn Văn A lúc 09:00', url: '/crm/today', tag: 'noti-1', type: 'APPOINTMENT_ASSIGNED' })),
      );

      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification).toHaveBeenCalledWith('Lịch hẹn mới', {
        body: 'Nguyễn Văn A lúc 09:00',
        icon: NOTIFICATION_ICON,
        tag: 'noti-1',
        data: { url: '/crm/today' },
      });
    });

    it.each([
      ['không kèm dữ liệu', null],
      ['dữ liệu không phải JSON', pushText('đây không phải json')],
      ['dữ liệu là JSON mảng', pushText('[1,2]')],
      [
        'đọc dữ liệu ném lỗi',
        {
          text: () => {
            throw new Error('đọc lỗi');
          },
        },
      ],
    ])('FR-09: push %s vẫn LUÔN showNotification với nội dung chung "Bạn có thông báo mới" (không push im lặng)', async (_label, data) => {
      await dispatchPush(data);

      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification).toHaveBeenCalledWith('Bạn có thông báo mới', { body: '', icon: NOTIFICATION_ICON, tag: undefined, data: { url: '/' } });
    });

    it('FR-09: url ngoài hợp đồng trong push (tuyệt đối, //, /api) bị chuẩn hóa về "/" trước khi lưu vào data', async () => {
      for (const url of ['https://evil.example', '//evil.example', '/api/v1/auth/me']) {
        showNotification.mockClear();
        await dispatchPush(pushText(JSON.stringify({ title: 'T', url })));
        expect(showNotification.mock.calls[0][1]).toMatchObject({ data: { url: '/' } });
      }
    });

    it('FR-09: push không gọi fetch/cache (không chạm /api, ràng buộc PT-030)', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      await dispatchPush(pushText(JSON.stringify({ title: 'T', url: '/crm/today' })));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(matchPrecacheMock).not.toHaveBeenCalled();
    });

    it('FR-09: bấm thông báo khi chưa có cửa sổ thì đóng thông báo và openWindow tới đường dẫn nội bộ', async () => {
      const { close, waitUntil } = await dispatchClick({ url: '/crm/customers/66b1' });

      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
      expect(openWindow).toHaveBeenCalledWith(targetOf('/crm/customers/66b1'));
    });

    it('FR-09: bấm thông báo khi đã có cửa sổ thì focus rồi navigate, KHÔNG openWindow', async () => {
      const existing = createWindowClient();

      await dispatchClick({ url: '/crm/today' }, [existing]);

      expect(existing.focus).toHaveBeenCalledTimes(1);
      expect(existing.navigate).toHaveBeenCalledWith(targetOf('/crm/today'));
      expect(existing.focus.mock.invocationCallOrder[0]).toBeLessThan(existing.navigate.mock.invocationCallOrder[0]);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('FR-09: nhiều cửa sổ thì ưu tiên cửa sổ đang focus (trước cửa sổ chỉ hiển thị và cửa sổ đầu tiên)', async () => {
      const first = createWindowClient();
      const visible = createWindowClient({ visibilityState: 'visible' });
      const focused = createWindowClient({ focused: true, visibilityState: 'visible' });

      await dispatchClick({ url: '/notifications' }, [first, visible, focused]);

      expect(focused.navigate).toHaveBeenCalledTimes(1);
      expect(visible.navigate).not.toHaveBeenCalled();
      expect(first.navigate).not.toHaveBeenCalled();
    });

    it('FR-09: không có cửa sổ focus thì chọn cửa sổ đang hiển thị, không có nữa thì cửa sổ đầu tiên', async () => {
      const first = createWindowClient();
      const visible = createWindowClient({ visibilityState: 'visible' });
      await dispatchClick({ url: '/notifications' }, [first, visible]);
      expect(visible.navigate).toHaveBeenCalledWith(targetOf('/notifications'));
      expect(first.navigate).not.toHaveBeenCalled();

      const a = createWindowClient();
      const b = createWindowClient();
      await dispatchClick({ url: '/notifications' }, [a, b]);
      expect(a.navigate).toHaveBeenCalledWith(targetOf('/notifications'));
      expect(b.navigate).not.toHaveBeenCalled();
    });

    it('FR-09: navigate bị từ chối (cửa sổ không do SW kiểm soát) thì rơi xuống openWindow', async () => {
      const existing = createWindowClient({ navigate: vi.fn().mockRejectedValue(new TypeError('navigate refused')) });

      await dispatchClick({ url: '/crm/today' }, [existing]);

      expect(existing.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).toHaveBeenCalledWith(targetOf('/crm/today'));
    });

    it.each([
      ['URL tuyệt đối', { url: 'https://evil.example/phish' }],
      ['protocol-relative', { url: '//evil.example' }],
      ['javascript:', { url: 'javascript:alert(1)' }],
      ['đường dẫn /api', { url: '/api/v1/auth/me' }],
      ['url không phải chuỗi', { url: 42 }],
      ['thiếu url', {}],
      ['data là null', null],
      ['data không phải object', 'chuỗi'],
      ['data không có', undefined],
    ])('FR-09: bấm thông báo có %s thì chỉ mở "/" (không bao giờ mở URL ngoài)', async (_label, data) => {
      await dispatchClick(data);

      expect(openWindow).toHaveBeenCalledTimes(1);
      expect(openWindow).toHaveBeenCalledWith(targetOf('/'));
    });
  });
});
