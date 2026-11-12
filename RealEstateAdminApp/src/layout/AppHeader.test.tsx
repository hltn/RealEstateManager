import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cờ CRM điều khiển được trong test (mặc định bật); đổi qua `crmFlag.isPrototypeEnabled`.
const crmFlag = vi.hoisted(() => ({ isPrototypeEnabled: true }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: crmFlag }));

const fetchUnreadCount = vi.fn();

vi.mock('@crm/api/http/schedulingApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/schedulingApi')>('@crm/api/http/schedulingApi');
  return { ...real, fetchUnreadCount: (...args: unknown[]) => fetchUnreadCount(...args) };
});

// Các context/khối con không liên quan tới chấm đỏ: thay bằng bản rỗng để test chỉ tập trung vào AppHeader.
vi.mock('../context/SidebarContext', () => ({ useSidebar: () => ({ isMobileOpen: false, toggleSidebar: vi.fn(), toggleMobileSidebar: vi.fn() }) }));
vi.mock('../context/AnalyzeJobContext', () => ({ useAnalyzeJob: () => ({ status: 'idle', errorMessage: null, clearResult: vi.fn() }) }));
vi.mock('../context/ManageWpStatusContext', () => ({
  useManageWpStatus: () => ({
    crawlStatus: 'idle',
    crawlError: null,
    marketAnalysisStatus: 'idle',
    marketAnalysisError: null,
    clearCrawlStatus: vi.fn(),
    clearMarketAnalysisStatus: vi.fn(),
  }),
}));
vi.mock('../components/common/ThemeToggleButton', () => ({ ThemeToggleButton: () => null }));
vi.mock('../components/header/UserDropdown', () => ({ default: () => null }));

import { CrmApiException } from '@crm/api/http/crmErrors';
import { useAuthStore } from '../stores/auth.store';
import AppHeader from './AppHeader';

/** Khóa query của `useUnreadNotificationCount` (khớp `crmKeys.data` + 'notifications' + 'unread-count' trong hooks.ts). */
const UNREAD_COUNT_KEY = ['crm', 'data', 'notifications', 'unread-count'];

const renderHeader = (seed?: (client: QueryClient) => void) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
};

/** Chờ mọi query đang chạy xong (kết quả đã áp vào UI) trước khi assert phủ định, tránh đậu oan khi dữ liệu chưa về. */
const waitForQueriesSettled = (client: QueryClient) => waitFor(() => expect(client.isFetching()).toBe(0));

/** Chờ thêm một tick để chắc không có query nào được kích hoạt muộn. */
const flushTick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

/** Khẳng định query unread-count KHÔNG hề được kích hoạt (không gọi API, không có fetch đang chạy). */
const expectUnreadQueryNotActivated = async (client: QueryClient) => {
  await flushTick();
  expect(fetchUnreadCount).not.toHaveBeenCalled();
  expect(client.isFetching({ queryKey: UNREAD_COUNT_KEY })).toBe(0);
};

const menuButton = () => screen.getByRole('button', { name: /^Mở menu/ });

beforeEach(() => {
  crmFlag.isPrototypeEnabled = true;
  fetchUnreadCount.mockReset();
  fetchUnreadCount.mockResolvedValue(3);
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'STAFF' }, isInitialized: true });
});

describe('AppHeader: chấm đỏ chưa đọc trên nút ba chấm (mobile)', () => {
  it('có thông báo chưa đọc và menu đóng: hiện chấm đỏ, ẩn khỏi trình đọc màn hình, nút có aria-label nhắc chưa đọc', async () => {
    renderHeader();

    const dot = await screen.findByTestId('header-menu-unread-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('bg-red-500');
    expect(menuButton()).toHaveAttribute('aria-label', 'Mở menu, có thông báo chưa đọc');
    expect(menuButton()).toContainElement(dot);
  });

  it('không có thông báo chưa đọc (unread = 0): sau khi query xong vẫn không hiện chấm, aria-label không nhắc chưa đọc', async () => {
    fetchUnreadCount.mockResolvedValue(0);
    const { client } = renderHeader();

    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    await waitForQueriesSettled(client);
    expect(client.getQueryData(UNREAD_COUNT_KEY)).toBe(0);
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-label', 'Mở menu');
  });

  it('bấm mở menu thì chấm ẩn (đã thấy chuông + badge số); đóng lại thì chấm hiện lại; aria-expanded đổi theo', async () => {
    renderHeader();
    await screen.findByTestId('header-menu-unread-dot');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(menuButton());
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
    expect(screen.getByTestId('notification-bell-count')).toHaveTextContent('3');
    expect(menuButton()).toHaveAttribute('aria-label', 'Mở menu');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(menuButton());
    expect(await screen.findByTestId('header-menu-unread-dot')).toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('unread giảm từ > 0 về 0 (đã đọc hết): chấm biến mất và aria-label trở lại bình thường', async () => {
    const { client } = renderHeader();
    await screen.findByTestId('header-menu-unread-dot');

    act(() => {
      client.setQueryData(UNREAD_COUNT_KEY, 0);
    });

    await waitFor(() => expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument());
    expect(menuButton()).toHaveAttribute('aria-label', 'Mở menu');
  });

  it('unread rất lớn (100000): vẫn đúng 1 chấm, không nhân bản theo số', async () => {
    fetchUnreadCount.mockResolvedValue(100000);
    renderHeader();

    await screen.findByTestId('header-menu-unread-dot');
    expect(screen.getAllByTestId('header-menu-unread-dot')).toHaveLength(1);
  });

  it('API đếm chưa đọc lỗi (reject): không crash, không hiện chấm', async () => {
    fetchUnreadCount.mockRejectedValue(new CrmApiException({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Forbidden' }));
    const { client } = renderHeader();

    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    await waitForQueriesSettled(client);
    expect(client.getQueryState(UNREAD_COUNT_KEY)?.status).toBe('error');
    expect(menuButton()).toBeInTheDocument();
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-label', 'Mở menu');
  });

  it('cờ CRM tắt: không hiện chấm và query unread-count không được kích hoạt', async () => {
    crmFlag.isPrototypeEnabled = false;
    const { client } = renderHeader();

    await expectUnreadQueryNotActivated(client);
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
  });

  it('EDITOR thuần (không có quyền CRM): không hiện chấm và query unread-count không được kích hoạt', async () => {
    useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'EDITOR' }, isInitialized: true });
    const { client } = renderHeader();

    await expectUnreadQueryNotActivated(client);
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
  });

  it('chưa đăng nhập (user = null): không hiện chấm và query unread-count không được kích hoạt', async () => {
    useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
    const { client } = renderHeader();

    await expectUnreadQueryNotActivated(client);
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
  });

  it('bảo vệ vế quyền: cache đã có unread = 3 nhưng user chỉ EDITOR thì vẫn không hiện chấm', async () => {
    useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'EDITOR' }, isInitialized: true });
    const { client } = renderHeader((seeded) => seeded.setQueryData(UNREAD_COUNT_KEY, 3));

    await flushTick();
    // Cache có 3 thật (hook vẫn đọc được) nhưng điều kiện quyền chặn chấm đỏ.
    expect(client.getQueryData(UNREAD_COUNT_KEY)).toBe(3);
    expect(screen.queryByTestId('header-menu-unread-dot')).not.toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-label', 'Mở menu');
  });

  it('chuông và nút ba chấm cùng đọc một query: chỉ bắn 1 request đếm chưa đọc', async () => {
    renderHeader();
    await screen.findByTestId('header-menu-unread-dot');
    // Chuông luôn có trong DOM (chỉ bị CSS giấu dưới lg) và cùng dùng useUnreadNotificationCount.
    expect(screen.getByTestId('notification-bell-count')).toHaveTextContent('3');
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);
  });
});
