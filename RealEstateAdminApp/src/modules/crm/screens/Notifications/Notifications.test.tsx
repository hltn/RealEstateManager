import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmApiException } from '@crm/api/http/crmErrors';
import type { NotificationItem } from '@crm/api/http/schedulingApi';
import type { Paginated } from '@crm/api/types';
import NotificationsScreen from './index';

const fetchNotifications = vi.fn();

vi.mock('@crm/api/http/schedulingApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/schedulingApi')>('@crm/api/http/schedulingApi');
  return { ...real, fetchNotifications: (...args: unknown[]) => fetchNotifications(...args) };
});

const makeItem = (index: number): NotificationItem => ({
  id: `n${index}`,
  type: 'FOLLOW_UP_DUE',
  title: `Thông báo ${index}`,
  body: 'Nội dung',
  deepLink: '',
  priority: 'NORMAL',
  isRead: false,
  createdAt: '2026-11-01T03:00:00.000Z',
});

const makePage = (page: number, total: number, limit = 20): Paginated<NotificationItem> => {
  const start = (page - 1) * limit;
  const count = Math.max(0, Math.min(limit, total - start));
  return { data: Array.from({ length: count }, (_, offset) => makeItem(start + offset + 1)), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

/** IntersectionObserver giả: test chủ động báo "mốc cuối đã lọt vào khung nhìn" bằng `showSentinel()`. */
const observers = new Set<{ callback: IntersectionObserverCallback; target: Element | null }>();
class FakeObserver {
  private readonly entry: { callback: IntersectionObserverCallback; target: Element | null };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, target: null };
    observers.add(this.entry);
  }
  observe(target: Element) {
    this.entry.target = target;
  }
  disconnect() {
    observers.delete(this.entry);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const showSentinel = () =>
  act(() => {
    observers.forEach((entry) => entry.target && entry.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  });

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchNotifications.mockReset();
  observers.clear();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => vi.unstubAllGlobals());

describe('màn Thông báo: cuộn vô hạn (FR-38, T-56)', () => {
  it('hiện 20 mục đầu; mốc cuối vào khung nhìn thì tải thêm 20; hết danh sách thì báo "Đã hết thông báo"', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 45)).mockResolvedValueOnce(makePage(2, 45)).mockResolvedValueOnce(makePage(3, 45));
    renderScreen();

    expect(await screen.findByText('Thông báo 20')).toBeInTheDocument();
    expect(screen.queryByText('Thông báo 21')).not.toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenCalledTimes(1);

    showSentinel();
    expect(await screen.findByText('Thông báo 40')).toBeInTheDocument();
    expect(screen.queryByText('Thông báo 41')).not.toBeInTheDocument();

    showSentinel();
    expect(await screen.findByText('Thông báo 45')).toBeInTheDocument();
    expect(await screen.findByText('Đã hết thông báo')).toBeInTheDocument();
    expect(fetchNotifications.mock.calls.map(([query]) => (query as { page: number }).page)).toEqual([1, 2, 3]);

    // Hết danh sách: không còn mốc để quan sát nên không gọi thêm.
    showSentinel();
    expect(fetchNotifications).toHaveBeenCalledTimes(3);
  });

  it('báo mốc nhiều lần liên tiếp khi đang tải thì chỉ gọi trang kế một lần', async () => {
    let resolvePage2: (value: Paginated<NotificationItem>) => void = () => undefined;
    fetchNotifications.mockResolvedValueOnce(makePage(1, 60)).mockReturnValueOnce(new Promise((resolve) => (resolvePage2 = resolve)));
    renderScreen();
    await screen.findByText('Thông báo 20');

    showSentinel();
    showSentinel();
    showSentinel();
    expect(await screen.findByText('Đang tải thêm…')).toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenCalledTimes(2);

    await act(async () => resolvePage2(makePage(2, 60)));
    expect(await screen.findByText('Thông báo 40')).toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });

  it('lỗi khi tải trang kế: giữ danh sách đã tải, hiện nút "Thử lại" và không tự tải lặp; bấm thử lại thì tải được', async () => {
    fetchNotifications
      .mockResolvedValueOnce(makePage(1, 45))
      .mockRejectedValueOnce(new CrmApiException({ statusCode: 400, errorCode: 'BAD_REQUEST', message: 'Lỗi tạm' }))
      .mockResolvedValueOnce(makePage(2, 45));
    renderScreen();
    await screen.findByText('Thông báo 20');

    showSentinel();
    const retryButton = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getByText('Thông báo 20')).toBeInTheDocument();
    expect(screen.getByText('Không tải thêm được thông báo.')).toBeInTheDocument();

    // Mốc vẫn "thấy" nhưng đã dừng quan sát khi lỗi: không gọi lặp.
    showSentinel();
    expect(fetchNotifications).toHaveBeenCalledTimes(2);

    await userEvent.click(retryButton);
    expect(await screen.findByText('Thông báo 40')).toBeInTheDocument();
    expect(fetchNotifications.mock.calls.map(([query]) => (query as { page: number }).page)).toEqual([1, 2, 2]);
  });

  it('lỗi tải trang đầu: hiện màn lỗi có nút "Thử lại" và tải lại được', async () => {
    // 4xx không bị `retryTransient` thử lại ngầm, nên lỗi hiện ngay và nút "Thử lại" là lần gọi thứ hai.
    fetchNotifications.mockRejectedValueOnce(new CrmApiException({ statusCode: 400, errorCode: 'BAD_REQUEST', message: 'Mất kết nối' })).mockResolvedValueOnce(makePage(1, 2));
    renderScreen();

    expect(await screen.findByRole('alert')).toHaveTextContent('Mất kết nối');
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Thông báo 2')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('danh sách rỗng: hiện trạng thái rỗng, không có mốc tải thêm', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 0));
    renderScreen();

    expect(await screen.findByText('Chưa có thông báo nào')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-sentinel')).not.toBeInTheDocument();
    expect(screen.queryByText('Đã hết thông báo')).not.toBeInTheDocument();
  });

  it('có liên kết "Cài đặt thông báo" tới /notification-settings (T-41, FR-09)', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 0));
    renderScreen();

    expect(await screen.findByRole('link', { name: /Cài đặt thông báo/ })).toHaveAttribute('href', '/notification-settings');
  });

  it('đổi sang tab "Chưa đọc" gọi lại từ trang 1 với isRead=false', async () => {
    fetchNotifications.mockImplementation(async (query: { isRead?: boolean }) => (query.isRead === false ? makePage(1, 1) : makePage(1, 30)));
    renderScreen();
    await screen.findByText('Thông báo 20');

    await userEvent.click(screen.getByRole('tab', { name: 'Chưa đọc' }));
    await waitFor(() => expect(screen.queryByText('Thông báo 20')).not.toBeInTheDocument());
    expect(screen.getByText('Thông báo 1')).toBeInTheDocument();
    expect(fetchNotifications.mock.calls.at(-1)?.[0]).toEqual({ isRead: false, page: 1, limit: 20 });
  });
});
