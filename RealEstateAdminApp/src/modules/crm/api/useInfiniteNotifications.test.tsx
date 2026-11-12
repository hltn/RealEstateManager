import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_PAGE_SIZE, useInfiniteNotifications, useNotificationActions } from './hooks';
import { CrmApiException } from './http/crmErrors';
import type { NotificationItem } from './http/schedulingApi';
import type { Paginated } from './types';

const fetchNotifications = vi.fn();
const patchNotificationRead = vi.fn();
const fetchUnreadCount = vi.fn();

vi.mock('@crm/api/http/schedulingApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/schedulingApi')>('@crm/api/http/schedulingApi');
  return {
    ...real,
    fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
    patchNotificationRead: (...args: unknown[]) => patchNotificationRead(...args),
    fetchUnreadCount: (...args: unknown[]) => fetchUnreadCount(...args),
  };
});

const makeItem = (index: number, overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: `n${index}`,
  type: 'FOLLOW_UP_DUE',
  title: `Thông báo ${index}`,
  body: 'Nội dung',
  deepLink: '',
  priority: 'NORMAL',
  isRead: false,
  createdAt: '2026-11-01T03:00:00.000Z',
  ...overrides,
});

/** Trang `page` của một danh sách `total` mục, mỗi trang đúng `limit` mục (mục cuối có thể ít hơn). */
const makePage = (page: number, total: number, limit = NOTIFICATION_PAGE_SIZE): Paginated<NotificationItem> => {
  const start = (page - 1) * limit;
  const count = Math.max(0, Math.min(limit, total - start));
  return {
    data: Array.from({ length: count }, (_, offset) => makeItem(start + offset + 1)),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

const pagesRequested = () => fetchNotifications.mock.calls.map(([query]) => (query as { page: number }).page);

beforeEach(() => {
  fetchNotifications.mockReset();
  patchNotificationRead.mockReset();
  fetchUnreadCount.mockReset();
  fetchUnreadCount.mockResolvedValue(0);
});

describe('useInfiniteNotifications: phân trang (FR-38, T-56)', () => {
  it('trang đầu gọi page=1, limit=20 và trả đúng 20 mục, còn trang kế', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 45));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchNotifications).toHaveBeenCalledTimes(1);
    expect(fetchNotifications.mock.calls[0][0]).toEqual({ isRead: undefined, page: 1, limit: 20 });
    expect(result.current.data).toHaveLength(20);
    expect(result.current.total).toBe(45);
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore tải thêm đúng 20 mục kế tiếp, nối vào cuối và giữ thứ tự (mới nhất trước)', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 45)).mockResolvedValueOnce(makePage(2, 45));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data).toHaveLength(40));

    expect(pagesRequested()).toEqual([1, 2]);
    expect(result.current.data[0].id).toBe('n1');
    expect(result.current.data[39].id).toBe('n40');
    expect(result.current.hasMore).toBe(true);
  });

  it('hết danh sách: trang cuối ít hơn 20 mục thì hasMore=false và loadMore không gọi API nữa', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 25)).mockResolvedValueOnce(makePage(2, 25));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data).toHaveLength(25));
    expect(result.current.hasMore).toBe(false);

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });

  it('đúng 20 mục (1 trang) thì hasMore=false ngay, không gọi trang 2', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 20));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    expect(result.current.hasMore).toBe(false);
    act(() => result.current.loadMore());
    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it('danh sách rỗng: data=[], hasMore=false, không lỗi', async () => {
    fetchNotifications.mockResolvedValueOnce(makePage(1, 0));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});

describe('useInfiniteNotifications: không gọi trùng', () => {
  it('gọi loadMore nhiều lần liên tiếp trong cùng một nhịp chỉ tải trang kế đúng một lần', async () => {
    let resolvePage2: (value: Paginated<NotificationItem>) => void = () => undefined;
    fetchNotifications.mockResolvedValueOnce(makePage(1, 60)).mockReturnValueOnce(new Promise((resolve) => (resolvePage2 = resolve)));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.isFetchingMore).toBe(true));
    act(() => result.current.loadMore());

    expect(pagesRequested()).toEqual([1, 2]);

    await act(async () => resolvePage2(makePage(2, 60)));
    await waitFor(() => expect(result.current.data).toHaveLength(40));
    expect(pagesRequested()).toEqual([1, 2]);
  });

  it('mount lại cùng bộ lọc trong thời hạn tươi dùng cache, không gọi lại trang đầu', async () => {
    fetchNotifications.mockResolvedValue(makePage(1, 20));
    const { wrapper } = createWrapper();
    const first = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(first.result.current.data).toHaveLength(20));
    first.unmount();

    const second = renderHook(() => useInfiniteNotifications(), { wrapper });
    expect(second.result.current.data).toHaveLength(20);
    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it('isEnabled=false thì không gọi API', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications({}, false), { wrapper });
    expect(fetchNotifications).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });
});

describe('useInfiniteNotifications: lỗi giữa chừng', () => {
  it('trang 2 lỗi: giữ nguyên 20 mục đã tải, isLoadMoreError=true; loadMore lại thì thử lại đúng trang 2', async () => {
    fetchNotifications
      .mockResolvedValueOnce(makePage(1, 45))
      .mockRejectedValueOnce(new CrmApiException({ statusCode: 400, errorCode: 'BAD_REQUEST', message: 'Lỗi tạm' }))
      .mockResolvedValueOnce(makePage(2, 45));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadMoreError).toBe(true));
    expect(result.current.data).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data).toHaveLength(40));
    expect(result.current.isLoadMoreError).toBe(false);
    expect(pagesRequested()).toEqual([1, 2, 2]);
  });

  it('trang đầu lỗi: isError=true, error có thông điệp, data rỗng; refetch tải lại được', async () => {
    fetchNotifications
      .mockRejectedValueOnce(new CrmApiException({ statusCode: 403, errorCode: 'FORBIDDEN', message: 'Không có quyền' }))
      .mockResolvedValueOnce(makePage(1, 3));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toMatchObject({ statusCode: 403, message: 'Không có quyền' });
    expect(result.current.data).toEqual([]);

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.isError).toBe(false);
  });
});

describe('useInfiniteNotifications: bộ lọc và dữ liệu', () => {
  it('isRead=false truyền xuống API và dùng khóa cache riêng với "tất cả"', async () => {
    fetchNotifications.mockImplementation(async (query: { isRead?: boolean }) => (query.isRead === false ? makePage(1, 2) : makePage(1, 30)));
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(({ isRead }: { isRead?: boolean }) => useInfiniteNotifications({ isRead }), { wrapper, initialProps: { isRead: undefined as boolean | undefined } });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    rerender({ isRead: false });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(fetchNotifications.mock.calls.map(([query]) => (query as { isRead?: boolean }).isRead)).toEqual([undefined, false]);
    expect(fetchNotifications.mock.calls[1][0]).toMatchObject({ page: 1, limit: 20 });
  });

  it('loại mục trùng id ở biên trang (thông báo mới làm lệch trang) nhưng giữ nguyên thứ tự xuất hiện đầu tiên', async () => {
    const page1 = makePage(1, 40);
    const page2 = makePage(2, 40);
    page2.data[0] = makeItem(20, { title: 'Bản trùng' });
    fetchNotifications.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInfiniteNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(20));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data).toHaveLength(39));

    const ids = result.current.data.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.current.data.find((item) => item.id === 'n20')?.title).toBe('Thông báo 20');
  });
});

describe('đánh dấu đã đọc làm tươi cả danh sách và số chưa đọc', () => {
  it('markRead thành công -> tải lại danh sách vô hạn lẫn unread-count; thất bại thì không tải lại', async () => {
    fetchNotifications.mockResolvedValue(makePage(1, 3));
    patchNotificationRead.mockResolvedValueOnce({}).mockRejectedValueOnce(new CrmApiException({ statusCode: 400, errorCode: 'BAD_REQUEST', message: 'Lỗi' }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => ({ list: useInfiniteNotifications(), actions: useNotificationActions() }), { wrapper });
    await waitFor(() => expect(result.current.list.data).toHaveLength(3));
    const { useUnreadNotificationCount } = await import('./hooks');
    const unread = renderHook(() => useUnreadNotificationCount(true), { wrapper });
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalledTimes(1));

    await act(async () => {
      const outcome = await result.current.actions.markRead('n1', true);
      expect(outcome.ok).toBe(true);
    });
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalledTimes(2));

    await act(async () => {
      const outcome = await result.current.actions.markRead('n2', true);
      expect(outcome.ok).toBe(false);
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
    expect(fetchUnreadCount).toHaveBeenCalledTimes(2);
    unread.unmount();
  });
});
