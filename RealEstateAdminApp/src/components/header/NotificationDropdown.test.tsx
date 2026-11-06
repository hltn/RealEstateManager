import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isPrototypeEnabled: true } }));

const fetchNotifications = vi.fn();
const fetchUnreadCount = vi.fn();

vi.mock('@crm/api/http/schedulingApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/schedulingApi')>('@crm/api/http/schedulingApi');
  return {
    ...real,
    fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
    fetchUnreadCount: (...args: unknown[]) => fetchUnreadCount(...args),
  };
});

import { useAuthStore } from '../../stores/auth.store';
import NotificationDropdown from './NotificationDropdown';

const LocationProbe = () => <span data-testid="pathname">{useLocation().pathname}</span>;

const renderBell = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/crm/customers']}>
        <NotificationDropdown />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** Giả lập `matchMedia` theo độ rộng viewport (jsdom không có): chỉ hiểu truy vấn `(max-width: Npx)`. */
const stubViewportWidth = (width: number) => {
  window.matchMedia = ((query: string) => {
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    return { matches: width <= maxWidth, media: query, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};

beforeEach(() => {
  fetchNotifications.mockReset();
  fetchUnreadCount.mockReset();
  fetchUnreadCount.mockResolvedValue(3);
  fetchNotifications.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 8, totalPages: 0 } });
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'STAFF' }, isInitialized: true });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('NotificationDropdown: chuông trên mobile điều hướng sang màn (FR-38, T-56)', () => {
  it('mobile (< md): bấm chuông điều hướng sang /notifications, không mở popup và không tải danh sách xem nhanh', async () => {
    stubViewportWidth(390);
    renderBell();

    await userEvent.click(screen.getByTestId('notification-bell'));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/notifications');
    expect(screen.queryByText('Xem tất cả thông báo')).not.toBeInTheDocument();
    expect(fetchNotifications).not.toHaveBeenCalled();
  });

  it('desktop (>= md): bấm chuông mở popup tại chỗ, không đổi route', async () => {
    stubViewportWidth(1280);
    renderBell();

    await userEvent.click(screen.getByTestId('notification-bell'));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/crm/customers');
    expect(await screen.findByText('Xem tất cả thông báo')).toBeInTheDocument();
  });

  it('người dùng không có quyền CRM (EDITOR) thì không hiện chuông', () => {
    useAuthStore.setState({ user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'EDITOR' } });
    stubViewportWidth(390);
    renderBell();

    expect(screen.queryByTestId('notification-bell')).not.toBeInTheDocument();
  });
});
