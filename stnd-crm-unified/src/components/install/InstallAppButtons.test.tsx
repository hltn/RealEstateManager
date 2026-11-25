import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InstallAppButtons from './InstallAppButtons';
import { detectInstallPlatform, resolveInstallButtons } from './installPlatform';

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

afterEach(() => {
  for (const key of ['userAgent', 'platform', 'maxTouchPoints', 'standalone']) Reflect.deleteProperty(navigator, key);
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('detectInstallPlatform / resolveInstallButtons', () => {
  it('nhận diện đủ nền tảng', () => {
    expect(detectInstallPlatform({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 })).toBe('android');
    expect(detectInstallPlatform({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallPlatform({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallPlatform({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('other');
    expect(detectInstallPlatform({ userAgent: WINDOWS_UA, platform: 'Win32', maxTouchPoints: 10 })).toBe('other');
    expect(detectInstallPlatform({ userAgent: '', platform: '', maxTouchPoints: 0 })).toBe('unknown');
  });

  it('chọn nút theo nền tảng', () => {
    expect(resolveInstallButtons('android')).toEqual({ isAndroidVisible: true, isIosVisible: false });
    expect(resolveInstallButtons('ios')).toEqual({ isAndroidVisible: false, isIosVisible: true });
    expect(resolveInstallButtons('other')).toEqual({ isAndroidVisible: true, isIosVisible: true });
    expect(resolveInstallButtons('unknown')).toEqual({ isAndroidVisible: true, isIosVisible: true });
  });
});

describe('InstallAppButtons: hiện/ẩn nút', () => {
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

  it('máy tính hiện cả hai nút', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);
    expect(screen.getByRole('button', ANDROID_BUTTON)).toBeInTheDocument();
    expect(screen.getByRole('button', IOS_BUTTON)).toBeInTheDocument();
  });

  it('ẩn hoàn toàn khi display-mode: standalone', () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    mockDisplayModeStandalone(true);
    const { container } = render(<InstallAppButtons />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ẩn hoàn toàn khi navigator.standalone (iOS mở từ Màn hình chính)', () => {
    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5, standalone: true });
    const { container } = render(<InstallAppButtons />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('InstallAppButtons: logo store trên nút', () => {
  const buttonLogo = (button: HTMLElement, testId: string) => button.querySelector(`svg[data-testid="${testId}"]`);

  it('máy tính: nút Android có logo Google Play (không có Apple), nút iOS có logo Apple (không có Google Play)', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);
    const androidButton = screen.getByRole('button', ANDROID_BUTTON);
    const iosButton = screen.getByRole('button', IOS_BUTTON);

    expect(buttonLogo(androidButton, 'google-play-icon')).not.toBeNull();
    expect(buttonLogo(androidButton, 'apple-icon')).toBeNull();
    expect(buttonLogo(iosButton, 'apple-icon')).not.toBeNull();
    expect(buttonLogo(iosButton, 'google-play-icon')).toBeNull();
  });

  it('logo ẩn khỏi trình đọc màn hình, nên tên nút vẫn chỉ là chữ', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);

    for (const testId of ['google-play-icon', 'apple-icon']) {
      expect(screen.getByTestId(testId)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('logo Apple đơn sắc theo currentColor (hợp dark mode), logo Google Play giữ màu riêng', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    render(<InstallAppButtons />);

    expect(screen.getByTestId('apple-icon')).toHaveAttribute('fill', 'currentColor');
    expect(screen.getByTestId('google-play-icon')).not.toHaveAttribute('fill');
    expect(screen.getByTestId('google-play-icon').querySelectorAll('path[fill^="#"]')).toHaveLength(4);
  });

  it('không còn icon Smartphone (lucide) trên cả hai nút', () => {
    setNavigator({ userAgent: WINDOWS_UA, platform: 'Win32' });
    const { container } = render(<InstallAppButtons />);

    expect(container.querySelector('svg.lucide-smartphone')).toBeNull();
    expect(container.querySelectorAll('button svg')).toHaveLength(2);
  });

  it('Android chỉ hiện logo Google Play, iPhone chỉ hiện logo Apple', () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    const { unmount } = render(<InstallAppButtons />);
    expect(screen.getByTestId('google-play-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('apple-icon')).not.toBeInTheDocument();
    unmount();

    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    expect(screen.getByTestId('apple-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('google-play-icon')).not.toBeInTheDocument();
  });
});

describe('InstallAppButtons: hộp thoại hướng dẫn', () => {
  it('nút Android luôn mở hướng dẫn dự phòng qua menu trình duyệt (prototype không có prompt cài tự động)', async () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', ANDROID_BUTTON));

    const dialog = screen.getByRole('dialog', { name: 'Cài ứng dụng trên Android' });
    expect(dialog).toHaveTextContent('Cài đặt ứng dụng');
    expect(dialog).toHaveTextContent('Thêm vào Màn hình chính');
    expect(screen.getByTestId('install-app-url')).toHaveTextContent(window.location.origin);
  });

  it('nút iOS mở hướng dẫn Chia sẻ, Thêm vào MH chính; Safari thì không nhắc đổi trình duyệt', async () => {
    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    const dialog = screen.getByRole('dialog', { name: 'Cài ứng dụng trên iPhone/iPad' });
    expect(dialog).toHaveTextContent('Chia sẻ');
    expect(dialog).toHaveTextContent('Thêm vào MH chính');
    expect(dialog).not.toHaveTextContent('Hãy mở địa chỉ bên dưới bằng Safari');
  });

  it('Chrome trên iPhone: nhắc mở bằng Safari', async () => {
    setNavigator({ userAgent: IPHONE_CHROME_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);

    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    expect(screen.getByRole('dialog')).toHaveTextContent('Hãy mở địa chỉ bên dưới bằng Safari');
  });

  it('bấm "Đã hiểu" đóng hộp thoại', async () => {
    setNavigator({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 });
    render(<InstallAppButtons />);
    await userEvent.click(screen.getByRole('button', IOS_BUTTON));

    await userEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
