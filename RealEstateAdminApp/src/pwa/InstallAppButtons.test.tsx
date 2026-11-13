import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InstallAppButtons from './InstallAppButtons';
import { startInstallPromptCapture, type BeforeInstallPromptEvent } from './installPromptCapture';

/** Giả `runtimeConfig` (đọc một lần khi nạp module nên test đổi `appUrl` qua đối tượng này). Mặc định rỗng = dùng origin. */
const mockRuntimeConfig = vi.hoisted(() => ({ appUrl: '' }));
vi.mock('../config/runtimeConfig', () => ({ runtimeConfig: mockRuntimeConfig }));

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1';
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ANDROID_BUTTON = { name: 'Cài app cho Android' };
const IOS_BUTTON = { name: 'Cài app cho iOS' };

interface NavigatorProps {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

const setNavigator = ({ userAgent, platform = '', maxTouchPoints = 0, standalone }: NavigatorProps) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
};

/** jsdom không có matchMedia: giả để kiểm nhánh `display-mode: standalone`. */
const mockDisplayModeStandalone = (isStandalone: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isStandalone && query === '(display-mode: standalone)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

const makePromptEvent = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  event.prompt = vi.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
};

let stopCapture: () => void;

beforeEach(() => {
  mockRuntimeConfig.appUrl = '';
  stopCapture = startInstallPromptCapture();
});

afterEach(() => {
  stopCapture();
  for (const key of ['userAgent', 'platform', 'maxTouchPoints', 'standalone']) Reflect.deleteProperty(navigator, key);
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('InstallAppButtons: hiện nút theo nền tảng', () => {
  it('Android chỉ có nút Android', () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', ANDROID_BUTTON)).toBeInTheDocument();
    expect(screen.queryByRole('button', IOS_BUTTON)).not.toBeInTheDocument();
  });

  it('iPhone chỉ có nút iOS', () => {
    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', IOS_BUTTON)).toBeInTheDocument();
    expect(screen.queryByRole('button', ANDROID_BUTTON)).not.toBeInTheDocument();
  });

  it('iPadOS (UA Macintosh + cảm ứng) chỉ có nút iOS', () => {
    setNavigator({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', IOS_BUTTON)).toBeInTheDocument();
    expect(screen.queryByRole('button', ANDROID_BUTTON)).not.toBeInTheDocument();
  });

  it('máy tính hiện cả hai nút', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', ANDROID_BUTTON)).toBeInTheDocument();
    expect(screen.getByRole('button', IOS_BUTTON)).toBeInTheDocument();
  });

  it('UA lạ (không xác định) hiện cả hai nút', () => {
    setNavigator({ userAgent: 'SomeCustomBot/1.0' });
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', ANDROID_BUTTON)).toBeInTheDocument();
    expect(screen.getByRole('button', IOS_BUTTON)).toBeInTheDocument();
  });
});

describe('InstallAppButtons: ẩn khi đã cài (standalone)', () => {
  it('ẩn hoàn toàn khi display-mode: standalone', () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    mockDisplayModeStandalone(true);
    const { container } = render(<InstallAppButtons />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ẩn hoàn toàn khi navigator.standalone (iOS mở từ Màn hình chính), kể cả máy chưa xác định nền tảng', () => {
    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5, standalone: true });
    const { container } = render(<InstallAppButtons />);
    expect(container).toBeEmptyDOMElement();
  });

  it('đối chứng: display-mode không phải standalone thì vẫn hiện nút', () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    mockDisplayModeStandalone(false);
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', ANDROID_BUTTON)).toBeInTheDocument();
  });
});

describe('InstallAppButtons: nút Android', () => {
  beforeEach(() => setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 }));

  it('đã bắt prompt (kể cả bắt TRƯỚC khi component mount): bấm gọi prompt() và không hiện hướng dẫn dự phòng', async () => {
    const event = makePromptEvent();
    window.dispatchEvent(event);
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompt tới SAU khi mount vẫn được dùng', async () => {
    render(<InstallAppButtons />);
    const event = makePromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('chưa có prompt: bấm mở hướng dẫn dự phòng qua menu trình duyệt kèm địa chỉ web (origin)', async () => {
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));

    const dialog = screen.getByRole('dialog', { name: 'Cài ứng dụng trên Android' });
    expect(dialog).toHaveTextContent('Cài đặt ứng dụng');
    expect(dialog).toHaveTextContent('Thêm vào Màn hình chính');
    expect(screen.getByTestId('install-app-url')).toHaveTextContent(window.location.origin);
  });

  it('prompt() lỗi: rơi về hướng dẫn dự phòng thay vì im lặng', async () => {
    const event = makePromptEvent();
    event.prompt = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    window.dispatchEvent(event);
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));

    expect(screen.getByRole('dialog', { name: 'Cài ứng dụng trên Android' })).toBeInTheDocument();
  });

  it('bấm lặp lúc hộp thoại cài của trình duyệt còn đang chờ: chỉ gọi prompt() một lần và không hiện hướng dẫn dự phòng', async () => {
    const event = makePromptEvent();
    let resolvePrompt: () => void = () => undefined;
    event.prompt = vi.fn(() => new Promise<void>((resolve) => (resolvePrompt = resolve)));
    window.dispatchEvent(event);
    render(<InstallAppButtons />);
    const androidButton = screen.getByRole('button', ANDROID_BUTTON);

    fireEvent.click(androidButton);
    fireEvent.click(androidButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => resolvePrompt());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Xong lượt thì cờ chặn được nhả: lần bấm sau (không còn prompt) rơi về hướng dẫn dự phòng.
    await userEvent.click(androidButton);
    expect(screen.getByRole('dialog', { name: 'Cài ứng dụng trên Android' })).toBeInTheDocument();
  });

  it('sau appinstalled: Android chỉ có nút Android thì cả phần cài app biến mất', () => {
    const { container } = render(<InstallAppButtons />);
    expect(screen.getByRole('button', ANDROID_BUTTON)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('prompt đã dùng một lần thì lần bấm sau rơi về hướng dẫn dự phòng', async () => {
    window.dispatchEvent(makePromptEvent('dismissed'));
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));
    expect(screen.getByRole('dialog', { name: 'Cài ứng dụng trên Android' })).toBeInTheDocument();
  });
});

describe('InstallAppButtons: sau appinstalled trên máy tính', () => {
  it('chỉ ẩn nút Android, nút iOS vẫn còn', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(screen.queryByRole('button', ANDROID_BUTTON)).not.toBeInTheDocument();
    expect(screen.getByRole('button', IOS_BUTTON)).toBeInTheDocument();
  });
});

describe('InstallAppButtons: hộp thoại iOS', () => {
  beforeEach(() => setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 }));

  it('không hiện hộp thoại trước khi bấm', () => {
    render(<InstallAppButtons />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('bấm nút iOS mở hộp thoại hướng dẫn Chia sẻ, Thêm vào MH chính và hiện địa chỉ web', async () => {
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    const dialog = screen.getByRole('dialog', { name: 'Cài ứng dụng trên iPhone/iPad' });
    expect(dialog).toHaveTextContent('Chia sẻ');
    expect(dialog).toHaveTextContent('Thêm vào MH chính');
    expect(screen.getByTestId('install-app-url')).toHaveTextContent(window.location.origin);
  });

  it('Safari thì không nhắc đổi trình duyệt', async () => {
    render(<InstallAppButtons />);
    await userEvent.click(screen.getByRole('button', IOS_BUTTON));
    expect(screen.getByRole('dialog')).not.toHaveTextContent('mở địa chỉ bên dưới bằng Safari');
  });

  it('Chrome trên iPhone: nhắc mở bằng Safari', async () => {
    setNavigator({ userAgent: IPHONE_CHROME_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    await userEvent.click(screen.getByRole('button', IOS_BUTTON));
    expect(screen.getByRole('dialog')).toHaveTextContent('Safari');
    expect(screen.getByRole('dialog')).toHaveTextContent('Hãy mở địa chỉ bên dưới bằng Safari');
  });

  it('nút "Đã hiểu" đóng hộp thoại', async () => {
    render(<InstallAppButtons />);
    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    await userEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Escape đóng hộp thoại và trả tiêu điểm về nút iOS', async () => {
    render(<InstallAppButtons />);
    const iosButton = screen.getByRole('button', IOS_BUTTON);
    await userEvent.click(iosButton);
    // Tiêu điểm vào hộp thoại lúc mở (nút "Đã hiểu" là data-autofocus).
    expect(screen.getByRole('button', { name: 'Đã hiểu' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(iosButton).toHaveFocus();
  });

  it('mở lại sau khi đóng vẫn hiện hướng dẫn (state không kẹt)', async () => {
    render(<InstallAppButtons />);
    await userEvent.click(screen.getByRole('button', IOS_BUTTON));
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    expect(screen.getByRole('dialog', { name: 'Cài ứng dụng trên iPhone/iPad' })).toBeInTheDocument();
  });
});

describe('InstallAppButtons: địa chỉ web trong hướng dẫn (FR-15 appUrl, FR-27)', () => {
  const APP_URL = 'https://crm.example.com';

  it('có runtimeConfig.appUrl: hộp thoại iOS hiện đúng appUrl (không phải origin)', async () => {
    mockRuntimeConfig.appUrl = APP_URL;
    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    expect(screen.getByTestId('install-app-url').textContent).toBe(APP_URL);
    expect(screen.getByTestId('install-app-url').textContent).not.toContain(window.location.origin);
  });

  it('có runtimeConfig.appUrl: hướng dẫn dự phòng Android cũng hiện appUrl', async () => {
    mockRuntimeConfig.appUrl = APP_URL;
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));

    expect(screen.getByTestId('install-app-url').textContent).toBe(APP_URL);
  });

  it('appUrl rỗng: rơi về window.location.origin', async () => {
    mockRuntimeConfig.appUrl = '';
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', IOS_BUTTON));
    expect(screen.getByTestId('install-app-url').textContent).toBe(window.location.origin);
  });
});
