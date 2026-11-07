import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import UserDropdown from './UserDropdown';

// Cờ CRM điều khiển được trong test (mặc định bật); đổi qua `crmFlag.isPrototypeEnabled`.
const crmFlag = vi.hoisted(() => ({ isPrototypeEnabled: true }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: crmFlag }));

const renderDropdown = () => {
  render(
    <MemoryRouter>
      <UserDropdown />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId('user-menu-toggle'));
};

const setUser = (role: string, roles?: string[]) => useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'An', role, roles } as never });

beforeEach(() => {
  crmFlag.isPrototypeEnabled = true;
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
});

describe('UserDropdown', () => {
  it('hiện TẤT CẢ role của tài khoản (không chỉ role cao nhất); đơn role cũ vẫn hiện đúng', () => {
    setUser('STAFF', ['STAFF', 'EDITOR']);
    renderDropdown();
    expect(screen.getByTestId('user-menu-roles')).toHaveTextContent('STAFF, EDITOR');
  });

  it('đơn role cũ (chỉ có role, không có roles) vẫn hiện đúng', () => {
    setUser('MANAGER');
    renderDropdown();
    expect(screen.getByTestId('user-menu-roles')).toHaveTextContent('MANAGER');
  });
});

describe('UserDropdown: liên kết "Cài đặt thông báo" (T-41, FR-09)', () => {
  it('tài khoản có vai trò CRM và cờ CRM bật thì có liên kết tới /notification-settings', () => {
    setUser('STAFF');
    renderDropdown();
    expect(screen.getByTestId('user-menu-notification-settings')).toHaveAttribute('href', '/notification-settings');
  });

  it('EDITOR thuần (không có vai trò CRM) thì không có liên kết', () => {
    setUser('EDITOR');
    renderDropdown();
    expect(screen.queryByTestId('user-menu-notification-settings')).not.toBeInTheDocument();
  });

  it('cờ CRM tắt thì không có liên kết dù có vai trò CRM', () => {
    crmFlag.isPrototypeEnabled = false;
    setUser('ADMIN');
    renderDropdown();
    expect(screen.queryByTestId('user-menu-notification-settings')).not.toBeInTheDocument();
  });
});
