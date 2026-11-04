import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_CHECK_INTERVAL_MS } from './serviceWorkerConfig';

const { registerSWMock, updateSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn(), updateSWMock: vi.fn() }));
vi.mock('virtual:pwa-register', () => ({ registerSW: registerSWMock }));

import { registerServiceWorker } from './registerServiceWorker';

interface RegisterOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

const setOnline = (isOnline: boolean) => Object.defineProperty(navigator, 'onLine', { value: isOnline, configurable: true });

describe('registerServiceWorker', () => {
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = { update } as unknown as ServiceWorkerRegistration;

  /** Mọi lần đăng ký trong test đều được gỡ sau đó để listener `visibilitychange` không rò sang test khác. */
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    registerSWMock.mockReset().mockReturnValue(updateSWMock);
    updateSWMock.mockReset().mockResolvedValue(undefined);
    update.mockClear();
    setOnline(true);
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    vi.stubEnv('PROD', true);
  });

  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.useRealTimers();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    Reflect.deleteProperty(navigator, 'onLine');
    Reflect.deleteProperty(document, 'visibilityState');
  });

  const register = (onUpdateAvailable = vi.fn()) => {
    const dispose = registerServiceWorker(onUpdateAvailable);
    disposers.push(dispose);
    const options = registerSWMock.mock.calls[0][0] as RegisterOptions;
    return { dispose, options, onUpdateAvailable };
  };

  it('KHÔNG đăng ký ngoài production (dev/test)', () => {
    vi.stubEnv('PROD', false);
    registerServiceWorker(vi.fn());
    expect(registerSWMock).not.toHaveBeenCalled();
  });

  it('KHÔNG đăng ký khi trình duyệt không hỗ trợ service worker', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    registerServiceWorker(vi.fn());
    expect(registerSWMock).not.toHaveBeenCalled();
  });

  it('có bản mới: báo lên UI nhưng CHƯA tự cập nhật; chỉ khi gọi applyUpdate mới updateSW(true)', () => {
    const { options, onUpdateAvailable } = register();
    options.onNeedRefresh?.();

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(updateSWMock).not.toHaveBeenCalled();

    const applyUpdate = onUpdateAvailable.mock.calls[0][0] as () => Promise<void>;
    void applyUpdate();
    expect(updateSWMock).toHaveBeenCalledWith(true);
  });

  it('kiểm tra bản mới khi tab/app quay lại visible, bỏ qua khi bị ẩn', () => {
    const { options } = register();
    options.onRegisteredSW?.('/sw.js', registration);

    setVisibility('hidden');
    expect(update).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua kiểm tra khi mất mạng', () => {
    const { options } = register();
    options.onRegisteredSW?.('/sw.js', registration);

    setOnline(false);
    setVisibility('visible');
    expect(update).not.toHaveBeenCalled();
  });

  it('kiểm tra định kỳ mỗi giờ', () => {
    const { options } = register();
    options.onRegisteredSW?.('/sw.js', registration);

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('lỗi mạng khi update() không làm văng lỗi chưa xử lý', async () => {
    update.mockRejectedValueOnce(new Error('network'));
    const { options } = register();
    options.onRegisteredSW?.('/sw.js', registration);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('update() bị từ chối (mất mạng giữa chừng) phải được xử lý: có gắn handler, không để unhandled rejection', () => {
    // Dùng hàm thường (KHÔNG vi.fn: vitest tự gắn .then vào kết quả mock nên che mất lỗi unhandled).
    // Promise bị từ chối mà không ai gắn handler (then/catch/await) => unhandled rejection; theo dõi qua .then.
    const rejected = Promise.reject(new Error('network'));
    const thenSpy = vi.spyOn(rejected, 'then');
    let updateCalls = 0;
    const rejectingRegistration = {
      update: () => {
        updateCalls += 1;
        return rejected;
      },
    } as unknown as ServiceWorkerRegistration;
    const { options } = register();
    options.onRegisteredSW?.('/sw.js', rejectingRegistration);

    setVisibility('visible');
    expect(updateCalls).toBe(1);
    expect(thenSpy).toHaveBeenCalled();
  });

  it('dispose gỡ timer và listener', () => {
    const { options, dispose } = register();
    options.onRegisteredSW?.('/sw.js', registration);
    dispose();

    setVisibility('visible');
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(update).not.toHaveBeenCalled();
  });

  it('dispose trước khi đăng ký xong thì không gắn listener về sau', () => {
    const { options, dispose } = register();
    dispose();
    options.onRegisteredSW?.('/sw.js', registration);

    setVisibility('visible');
    expect(update).not.toHaveBeenCalled();
  });
});
