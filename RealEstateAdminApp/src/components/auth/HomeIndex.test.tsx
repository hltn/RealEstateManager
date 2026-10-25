import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ isPrototypeEnabled: false }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: flags }));
vi.mock('../../screens/RawArticlesScreen', () => ({ default: () => <p>RAW ARTICLES</p> }));

import { useAuthStore } from '../../stores/auth.store';
import { UserRole } from '../../types/user';
import HomeIndex from './HomeIndex';

/** Đếm số lần điều hướng: vòng lặp vô hạn sẽ vượt ngưỡng và ném lỗi thay vì treo worker. */
const NavigationLimit = () => {
  const location = useLocation();
  const count = (globalThis as { __navCount?: number }).__navCount ?? 0;
  (globalThis as { __navCount?: number }).__navCount = count + 1;
  if (count > 20) throw new Error(`Vòng chuyển hướng tại ${location.pathname}`);
  return null;
};

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <NavigationLimit />
      <Routes>
        <Route path="/" element={<HomeIndex />} />
        <Route path="/crm/today" element={<p>MÀN CRM</p>} />
        {/* Giống App.tsx khi CRM tắt: /crm/* không có route -> về "/" */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );

const login = (role: (typeof UserRole)[keyof typeof UserRole]) =>
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role }, isInitialized: true });

beforeEach(() => {
  (globalThis as { __navCount?: number }).__navCount = 0;
  flags.isPrototypeEnabled = false;
});

describe('HomeIndex khi cờ CRM tắt (hồi quy vòng chuyển hướng vô hạn)', () => {
  it('MANAGER/STAFF thấy thông báo, KHÔNG chuyển hướng', () => {
    login(UserRole.STAFF);
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent('chưa khả dụng');
    expect((globalThis as { __navCount?: number }).__navCount).toBeLessThan(5);
  });

  it('cờ bật: STAFF được chuyển sang /crm/today; ADMIN vẫn vào Raw Articles', () => {
    flags.isPrototypeEnabled = true;
    login(UserRole.ADMIN);
    const { unmount } = renderApp();
    expect(screen.getByText('RAW ARTICLES')).toBeInTheDocument();
    unmount();
    login(UserRole.STAFF);
    renderApp();
    expect(screen.getByText("MÀN CRM")).toBeInTheDocument();
  });
});
