import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../stores/auth.store';
import IosInstallHint from './IosInstallHint';
import { IOS_INSTALL_HINT_DISMISSED_KEY } from './iosInstallHintLogic';

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const HINT_REGION = { name: 'Hướng dẫn cài ứng dụng' };

const setNavigator = (props: { userAgent?: string; platform?: string; standalone?: boolean }) => {
  Object.defineProperty(navigator, 'userAgent', { value: props.userAgent ?? IPHONE_SAFARI_UA, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: props.platform ?? 'iPhone', configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: props.standalone, configurable: true });
};

const login = () => useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'STAFF' }, isInitialized: true });

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
});

afterEach(() => {
  // Gỡ ghi đè để không rò sang test khác trong cùng worker.
  for (const key of ['userAgent', 'platform', 'maxTouchPoints', 'standalone']) Reflect.deleteProperty(navigator, key);
});

describe('IosInstallHint', () => {
  it('hiện hướng dẫn "Thêm vào MH chính" cho người đã đăng nhập trên iPhone Safari chưa cài', () => {
    setNavigator({});
    login();
    render(<IosInstallHint />);
    expect(screen.getByRole('region', HINT_REGION)).toHaveTextContent('Thêm vào MH chính');
  });

  it('không hiện khi chưa đăng nhập', () => {
    setNavigator({});
    render(<IosInstallHint />);
    expect(screen.queryByRole('region', HINT_REGION)).not.toBeInTheDocument();
  });

  it('không hiện khi đã mở từ Màn hình chính (navigator.standalone)', () => {
    setNavigator({ standalone: true });
    login();
    render(<IosInstallHint />);
    expect(screen.queryByRole('region', HINT_REGION)).not.toBeInTheDocument();
  });

  it('không hiện trên Android', () => {
    setNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv81' });
    login();
    render(<IosInstallHint />);
    expect(screen.queryByRole('region', HINT_REGION)).not.toBeInTheDocument();
  });

  it('bấm "Đã hiểu": ẩn ngay và lưu cờ để lần sau không hiện lại', async () => {
    setNavigator({});
    login();
    const { unmount } = render(<IosInstallHint />);
    await userEvent.click(screen.getByRole('button', { name: /Đã hiểu/ }));
    expect(screen.queryByRole('region', HINT_REGION)).not.toBeInTheDocument();
    expect(localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY)).toBe('true');

    unmount();
    render(<IosInstallHint />);
    expect(screen.queryByRole('region', HINT_REGION)).not.toBeInTheDocument();
  });
});
