import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginScreen from './LoginScreen';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const setNavigator = (userAgent: string) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: 'Linux armv81', configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
};

afterEach(() => {
  for (const key of ['userAgent', 'platform', 'maxTouchPoints']) Reflect.deleteProperty(navigator, key);
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('LoginScreen: nút cài app (FR-27)', () => {
  it('có phần cài app với nút đúng nền tảng cạnh nút Đăng nhập', () => {
    setNavigator(ANDROID_UA);
    render(
      <MemoryRouter>
        <LoginScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cài ứng dụng lên điện thoại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cài app cho Android' })).toBeInTheDocument();
  });

  it('app đã cài (standalone) thì màn đăng nhập không còn phần cài app', () => {
    setNavigator(ANDROID_UA);
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: query === '(display-mode: standalone)', media: query }));
    render(
      <MemoryRouter>
        <LoginScreen />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cài ứng dụng lên điện thoại' })).not.toBeInTheDocument();
  });
});
