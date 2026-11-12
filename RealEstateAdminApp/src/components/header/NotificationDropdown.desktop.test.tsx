import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isPrototypeEnabled: true } }));

const fetchNotifications = vi.fn();
const fetchUnreadCount = vi.fn();
const patchNotificationRead = vi.fn();

vi.mock('@crm/api/http/schedulingApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/schedulingApi')>('@crm/api/http/schedulingApi');
  return {
    ...real,
    fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
    fetchUnreadCount: (...args: unknown[]) => fetchUnreadCount(...args),
    patchNotificationRead: (...args: unknown[]) => patchNotificationRead(...args),
  };
});

import { CrmApiException } from '@crm/api/http/crmErrors';
import type { NotificationItem } from '@crm/api/http/schedulingApi';
import type { Paginated } from '@crm/api/types';
import { useAuthStore } from '../../stores/auth.store';
import { DROPDOWN_MAX_HEIGHT_PX, DROPDOWN_VIEWPORT_MARGIN_PX, computeHorizontalShift, computeMaxHeight } from './notificationDropdownLayout';
import NotificationDropdown from './NotificationDropdown';

const PAGE_SIZE = 20;

const makeItem = (index: number, overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: `n${index}`,
  type: 'FOLLOW_UP_DUE',
  title: `Thông báo ${index}`,
  body: 'Nội dung',
  deepLink: '',
  priority: 'NORMAL',
  isRead: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

/** Trang `page` của danh sách `total` mục, mỗi trang đúng `limit` mục (mục cuối có thể ít hơn). */
const makePage = (page: number, total: number, makeOne: (index: number) => NotificationItem = makeItem): Paginated<NotificationItem> => {
  const start = (page - 1) * PAGE_SIZE;
  const count = Math.max(0, Math.min(PAGE_SIZE, total - start));
  return {
    data: Array.from({ length: count }, (_, offset) => makeOne(start + offset + 1)),
    meta: { total, page, limit: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) },
  };
};

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

const stubViewportWidth = (width: number) => {
  window.matchMedia = ((query: string) => {
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    return { matches: width <= maxWidth, media: query, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};

/** IntersectionObserver giả: ghi lại các observer còn sống để test "cuộn tới cuối" bằng `scrollToEnd()`. */
class FakeIntersectionObserver {
  static live: FakeIntersectionObserver[] = [];

  private readonly callback: (entries: { isIntersecting: boolean }[]) => void;

  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
  }

  observe() {
    FakeIntersectionObserver.live.push(this);
  }

  disconnect() {
    FakeIntersectionObserver.live = FakeIntersectionObserver.live.filter((observer) => observer !== this);
  }

  trigger() {
    this.callback([{ isIntersecting: true }]);
  }
}

/** Mô phỏng người dùng cuộn tới cuối: mọi mốc đang được quan sát lọt vào khung nhìn. */
const scrollToEnd = () => {
  act(() => {
    FakeIntersectionObserver.live.slice().forEach((observer) => observer.trigger());
  });
};

const openDropdown = async () => {
  await userEvent.click(screen.getByTestId('notification-bell'));
  return screen.findByTestId('notification-dropdown');
};

const requestedQueries = () => fetchNotifications.mock.calls.map(([query]) => query as { page: number; limit: number; isRead?: boolean });

beforeEach(() => {
  fetchNotifications.mockReset();
  fetchUnreadCount.mockReset();
  patchNotificationRead.mockReset();
  fetchUnreadCount.mockResolvedValue(3);
  patchNotificationRead.mockResolvedValue(undefined);
  fetchNotifications.mockImplementation(async ({ page }: { page: number }) => makePage(page, 45));
  FakeIntersectionObserver.live = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  stubViewportWidth(1280);
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role: 'STAFF' }, isInitialized: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('NotificationDropdown desktop: neo dưới chuông, không tràn viewport (FR-38, T-57)', () => {
  it('FR-38: khung neo mép phải dưới chuông (right-0 top-full), KHÔNG còn lệch -right-[240px]', async () => {
    renderBell();
    const panel = await openDropdown();

    expect(panel).toHaveAttribute('role', 'dialog');
    expect(panel.className).toContain('right-0');
    expect(panel.className).toContain('top-full');
    expect(panel.className).not.toContain('-right-[240px]');
    // Nằm TRONG vùng `relative` của chuông (cùng cha với nút chuông) nên neo theo chuông chứ không theo header.
    expect(panel.parentElement).toBe(screen.getByTestId('notification-bell').parentElement);
    // Rộng tối đa theo viewport (cửa sổ hẹp không tràn).
    expect(panel.className).toContain('max-w-[calc(100vw-1rem)]');
  });

  it('FR-38: khung bị lệch trái quá mép viewport thì được dịch sang phải đúng mức để còn lề tối thiểu', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1024 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.dataset.testid === 'notification-dropdown' ? { left: -40, right: 320, top: 60, bottom: 500, width: 360, height: 440, x: -40, y: 60 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    });
    renderBell();
    const panel = await openDropdown();

    // Cần dịch +48 để mép trái = 8px (lề tối thiểu).
    expect(panel.style.transform).toBe(`translateX(${DROPDOWN_VIEWPORT_MARGIN_PX + 40}px)`);
  });

  it('FR-38: chuông ở hàng thấp (menu thu gọn) thì chiều cao khung bị giới hạn để đáy không vượt viewport', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.dataset.testid === 'notification-dropdown' ? { left: 300, right: 660, top: 160, bottom: 600, width: 360, height: 440, x: 300, y: 160 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    });
    renderBell();
    const panel = await openDropdown();

    expect(panel.style.maxHeight).toBe(`${600 - 160 - DROPDOWN_VIEWPORT_MARGIN_PX}px`);
  });

  it('FR-38: khung nằm gọn trong viewport thì KHÔNG dịch (không có transform)', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1280 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.dataset.testid === 'notification-dropdown' ? { left: 800, right: 1160, top: 60, bottom: 500, width: 360, height: 440, x: 800, y: 60 } : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    });
    renderBell();
    const panel = await openDropdown();

    expect(panel.style.transform).toBe('');
  });
});

describe('computeHorizontalShift (hình học, FR-38)', () => {
  const viewportWidth = 1000;

  it('FR-38: nằm gọn trong [8, viewport-8] thì không dịch (kể cả sát đúng lề)', () => {
    expect(computeHorizontalShift({ left: 300, right: 660, viewportWidth })).toBe(0);
    expect(computeHorizontalShift({ left: 8, right: 368, viewportWidth })).toBe(0);
    expect(computeHorizontalShift({ left: 632, right: 992, viewportWidth })).toBe(0);
  });

  it('FR-38: tràn trái thì dịch phải; tràn phải thì dịch trái, đều về đúng lề', () => {
    expect(computeHorizontalShift({ left: -30, right: 330, viewportWidth })).toBe(38);
    expect(computeHorizontalShift({ left: 700, right: 1060, viewportWidth })).toBe(-68);
  });

  it('FR-38: khung rộng hơn vùng cho phép (viewport rất hẹp) thì căn mép trái theo lề', () => {
    expect(computeHorizontalShift({ left: -20, right: 340, viewportWidth: 300 })).toBe(28);
  });
});

describe('computeMaxHeight (hình học dọc, FR-38)', () => {
  it('FR-38: viewport cao thì dùng trần 36rem; thấp thì chỉ lấy phần còn lại dưới khung trừ lề', () => {
    expect(computeMaxHeight({ top: 70, viewportHeight: 1000 })).toBe(DROPDOWN_MAX_HEIGHT_PX);
    expect(computeMaxHeight({ top: 160, viewportHeight: 600 })).toBe(600 - 160 - DROPDOWN_VIEWPORT_MARGIN_PX);
  });

  it('FR-38: khung bắt đầu sát/vượt đáy viewport thì không âm', () => {
    expect(computeMaxHeight({ top: 700, viewportHeight: 600 })).toBe(0);
  });
});

describe('NotificationDropdown desktop: tab, chấm xanh, thời gian tương đối (FR-38, T-57)', () => {
  it('FR-38: mở dropdown tải trang đầu đúng 20 mục, mới nhất trước; đóng thì không tải', async () => {
    renderBell();
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    expect(fetchNotifications).not.toHaveBeenCalled();

    await openDropdown();
    expect(await screen.findByText('Thông báo 1')).toBeInTheDocument();

    expect(requestedQueries()).toEqual([{ isRead: undefined, page: 1, limit: PAGE_SIZE }]);
    expect(within(screen.getByTestId('notification-dropdown-list')).getAllByRole('listitem')).toHaveLength(PAGE_SIZE);
  });

  it('FR-38: tab "Chưa đọc" gọi API với isRead=false và chỉ hiện các mục chưa đọc; về "Tất cả" hiện lại đủ', async () => {
    const mixed = (index: number) => makeItem(index, { isRead: index % 2 === 0 });
    fetchNotifications.mockImplementation(async ({ isRead, page }: { isRead?: boolean; page: number }) => {
      const all = Array.from({ length: 10 }, (_, offset) => mixed(offset + 1));
      const data = isRead === false ? all.filter((item) => !item.isRead) : all;
      return { data, meta: { total: data.length, page, limit: PAGE_SIZE, totalPages: 1 } };
    });
    renderBell();
    await openDropdown();
    expect(await screen.findAllByRole('listitem')).toHaveLength(10);

    await userEvent.click(screen.getByRole('tab', { name: 'Chưa đọc' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5));
    expect(requestedQueries().some((query) => query.isRead === false)).toBe(true);
    expect(screen.getByRole('tab', { name: 'Chưa đọc' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Thông báo 2')).not.toBeInTheDocument();
    expect(screen.getByText('Thông báo 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Tất cả' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(10));
  });

  it('FR-38: tab Chưa đọc không có mục nào thì hiện thông điệp riêng của tab đó', async () => {
    fetchNotifications.mockImplementation(async ({ isRead }: { isRead?: boolean }) => ({
      data: isRead === false ? [] : [makeItem(1, { isRead: true })],
      meta: { total: isRead === false ? 0 : 1, page: 1, limit: PAGE_SIZE, totalPages: isRead === false ? 0 : 1 },
    }));
    renderBell();
    await openDropdown();
    await screen.findByText('Thông báo 1');

    await userEvent.click(screen.getByRole('tab', { name: 'Chưa đọc' }));

    expect(await screen.findByText('Không có thông báo chưa đọc')).toBeInTheDocument();
  });

  it('FR-38: danh sách rỗng ở tab Tất cả hiện "Chưa có thông báo nào"', async () => {
    fetchNotifications.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 } });
    renderBell();
    await openDropdown();
    expect(await screen.findByText('Chưa có thông báo nào')).toBeInTheDocument();
  });

  it('FR-38: chấm xanh chỉ ở mục chưa đọc (mục đã đọc không có)', async () => {
    fetchNotifications.mockResolvedValue({
      data: [makeItem(1, { isRead: false }), makeItem(2, { isRead: true }), makeItem(3, { isRead: false })],
      meta: { total: 3, page: 1, limit: PAGE_SIZE, totalPages: 1 },
    });
    renderBell();
    await openDropdown();
    await screen.findByText('Thông báo 1');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByTestId('notification-unread-dot')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('notification-unread-dot')).not.toBeInTheDocument();
    expect(within(rows[2]).getByTestId('notification-unread-dot')).toBeInTheDocument();
  });

  it('FR-38: thời gian hiện dạng tương đối ("Hôm nay …", "Hôm qua …"), không phải ISO thô', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fetchNotifications.mockResolvedValue({
      data: [makeItem(1, { createdAt: new Date().toISOString() }), makeItem(2, { createdAt: yesterday })],
      meta: { total: 2, page: 1, limit: PAGE_SIZE, totalPages: 1 },
    });
    renderBell();
    await openDropdown();
    await screen.findByText('Thông báo 1');

    const times = document.querySelectorAll('time');
    expect(times[0]).toHaveTextContent(/^Hôm nay \d{2}:\d{2}$/);
    expect(times[1]).toHaveTextContent(/^Hôm qua \d{2}:\d{2}$/);
  });
});

describe('NotificationDropdown desktop: cuộn tải thêm 20 (FR-38, T-57)', () => {
  it('FR-38: cuộn tới cuối tải trang 2 (thêm 20), rồi trang 3 (còn 5) và dừng với "Đã hết thông báo"', async () => {
    renderBell();
    await openDropdown();
    await screen.findByText('Thông báo 1');
    expect(screen.getAllByRole('listitem')).toHaveLength(20);

    scrollToEnd();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(40));
    scrollToEnd();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(45));

    expect(await screen.findByText('Đã hết thông báo')).toBeInTheDocument();
    expect(requestedQueries().map((query) => query.page)).toEqual([1, 2, 3]);
    expect(requestedQueries().every((query) => query.limit === PAGE_SIZE)).toBe(true);
    // Hết danh sách: không còn mốc quan sát nên cuộn nữa cũng không gọi thêm.
    expect(screen.queryByTestId('notification-dropdown-sentinel')).not.toBeInTheDocument();
    scrollToEnd();
    expect(fetchNotifications).toHaveBeenCalledTimes(3);
  });

  it('FR-38: cuộn liên tiếp khi đang tải trang kế không gọi trùng cùng một trang', async () => {
    let releasePage2: (value: Paginated<NotificationItem>) => void = () => undefined;
    fetchNotifications.mockImplementation(({ page }: { page: number }) => (page === 2 ? new Promise((resolve) => (releasePage2 = resolve)) : Promise.resolve(makePage(page, 45))));
    renderBell();
    await openDropdown();
    await screen.findByText('Thông báo 1');

    scrollToEnd();
    scrollToEnd();
    scrollToEnd();
    await waitFor(() => expect(screen.getByText('Đang tải thêm…')).toBeInTheDocument());
    expect(requestedQueries().filter((query) => query.page === 2)).toHaveLength(1);

    await act(async () => releasePage2(makePage(2, 45)));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(40));
    expect(requestedQueries().filter((query) => query.page === 2)).toHaveLength(1);
  });

  it('FR-38: tải trang kế lỗi thì giữ các mục đã tải, hiện "Thử lại" và bấm thử lại tải được', async () => {
    let shouldFailPage2 = true;
    fetchNotifications.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 2 && shouldFailPage2) throw new CrmApiException({ statusCode: 400, errorCode: 'BAD_REQUEST', message: 'Lỗi tạm' });
      return makePage(page, 45);
    });
    renderBell();
    await openDropdown();
    await screen.findByText('Thông báo 1');

    scrollToEnd();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByText('Không tải thêm được thông báo.')).toBeInTheDocument();

    shouldFailPage2 = false;
    await userEvent.click(retry);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(40));
  });

  it('FR-38: lỗi tải trang đầu hiện thông điệp lỗi kèm nút thử lại', async () => {
    let shouldFail = true;
    fetchNotifications.mockImplementation(async ({ page }: { page: number }) => {
      if (shouldFail) throw new CrmApiException({ statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Không tải được thông báo.' });
      return makePage(page, 3);
    });
    renderBell();
    await openDropdown();

    expect(await screen.findByText('Không tải được thông báo.')).toBeInTheDocument();
    shouldFail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Thông báo 1')).toBeInTheDocument();
  });
});

describe('NotificationDropdown desktop: điều hướng và đóng (FR-38, T-57)', () => {
  it('FR-38: "Xem tất cả thông báo" sang /notifications và đóng dropdown', async () => {
    renderBell();
    await openDropdown();

    await userEvent.click(await screen.findByRole('link', { name: 'Xem tất cả thông báo' }));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/notifications');
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();
  });

  it('FR-38: bấm mục chưa đọc thì đánh dấu đã đọc, đóng dropdown và mở đúng màn liên quan', async () => {
    fetchNotifications.mockResolvedValue({
      data: [makeItem(1, { deepLink: '/crm/customers/abc123', isRead: false })],
      meta: { total: 1, page: 1, limit: PAGE_SIZE, totalPages: 1 },
    });
    renderBell();
    await openDropdown();

    await userEvent.click(await screen.findByText('Thông báo 1'));

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/crm/customers/abc123'));
    expect(patchNotificationRead).toHaveBeenCalledWith('n1', true);
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();
  });

  it('FR-38: bấm mục đã đọc thì chỉ điều hướng, không gọi đánh dấu đã đọc lần nữa', async () => {
    fetchNotifications.mockResolvedValue({
      data: [makeItem(1, { deepLink: '/crm/customers/abc123', isRead: true })],
      meta: { total: 1, page: 1, limit: PAGE_SIZE, totalPages: 1 },
    });
    renderBell();
    await openDropdown();

    await userEvent.click(await screen.findByText('Thông báo 1'));

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/crm/customers/abc123'));
    expect(patchNotificationRead).not.toHaveBeenCalled();
  });

  it('FR-38: bấm chuông lần nữa đóng dropdown; mở lại thì tab về "Tất cả"', async () => {
    renderBell();
    await openDropdown();
    await userEvent.click(screen.getByRole('tab', { name: 'Chưa đọc' }));
    await userEvent.click(screen.getByTestId('notification-bell'));
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();

    await openDropdown();

    expect(screen.getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true');
  });

  it('FR-38: bấm ra ngoài thì đóng dropdown, bấm bên trong thì không', async () => {
    renderBell();
    const panel = await openDropdown();

    await userEvent.click(screen.getByRole('tab', { name: 'Chưa đọc' }));
    expect(panel).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();
  });

  it('FR-38: Esc đóng dropdown, trả focus về chuông và đánh dấu defaultPrevented để ngăn kéo sidebar không đóng theo', async () => {
    renderBell();
    await openDropdown();
    const seenByDocument: boolean[] = [];
    const spy = (event: KeyboardEvent) => {
      if (event.key === 'Escape') seenByDocument.push(event.defaultPrevented);
    };
    document.addEventListener('keydown', spy);

    await userEvent.keyboard('{Escape}');
    document.removeEventListener('keydown', spy);

    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('notification-bell')).toHaveFocus();
    expect(seenByDocument).toEqual([true]);
  });

  it('FR-38: Esc khi dropdown đang đóng không bị chặn (không preventDefault)', async () => {
    renderBell();
    const seenByDocument: boolean[] = [];
    const spy = (event: KeyboardEvent) => seenByDocument.push(event.defaultPrevented);
    document.addEventListener('keydown', spy);

    await userEvent.keyboard('{Escape}');
    document.removeEventListener('keydown', spy);

    expect(seenByDocument).toEqual([false]);
  });
});
