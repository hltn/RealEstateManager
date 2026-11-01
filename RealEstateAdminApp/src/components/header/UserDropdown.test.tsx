import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import UserDropdown from './UserDropdown';

beforeEach(() => useAuthStore.setState({ accessToken: null, user: null, isInitialized: true }));

describe('UserDropdown', () => {
  it('hiện TẤT CẢ role của tài khoản (không chỉ role cao nhất); đơn role cũ vẫn hiện đúng', () => {
    useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'An', role: 'STAFF', roles: ['STAFF', 'EDITOR'] } });
    const { unmount } = render(<UserDropdown />);
    fireEvent.click(screen.getByTestId('user-menu-toggle'));
    expect(screen.getByTestId('user-menu-roles')).toHaveTextContent('STAFF, EDITOR');
    unmount();

    useAuthStore.setState({ user: { _id: 'u', email: 'a@b.vn', displayName: 'An', role: 'MANAGER' } });
    render(<UserDropdown />);
    fireEvent.click(screen.getByTestId('user-menu-toggle'));
    expect(screen.getByTestId('user-menu-roles')).toHaveTextContent('MANAGER');
  });
});
