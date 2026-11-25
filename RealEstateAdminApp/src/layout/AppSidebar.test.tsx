import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isPrototypeEnabled: true } }));

import { SidebarProvider, useSidebar } from '../context/SidebarContext';
import { useAuthStore } from '../stores/auth.store';
import type { UserRole } from '../types/user';
import AppSidebar, { FOCUSABLE_SELECTOR } from './AppSidebar';
import Backdrop from './Backdrop';

const loginWith = (role: UserRole, roles?: UserRole[]) => useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role, roles }, isInitialized: true });

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );

beforeEach(() => useAuthStore.setState({ accessToken: null, user: null, isInitialized: true }));

describe('AppSidebar theo HỢP các role', () => {
  it('STAFF+EDITOR: thấy cả CRM lẫn tin tức và AI Prompt Config', () => {
    loginWith('STAFF', ['STAFF', 'EDITOR']);
    renderSidebar();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(screen.getByText('Raw Articles')).toBeInTheDocument();
    expect(screen.getByText('AI Prompt Config')).toBeInTheDocument();
  });

  it('ADMIN+STAFF thấy cả CRM, tin tức lẫn mục quản trị; MANAGER+STAFF chỉ thấy CRM', () => {
    loginWith('ADMIN', ['ADMIN', 'STAFF']);
    const { unmount } = renderSidebar();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(screen.getByText('Raw Articles')).toBeInTheDocument();
    expect(screen.getByText('AI Config')).toBeInTheDocument();
    unmount();

    loginWith('MANAGER', ['MANAGER', 'STAFF']);
    renderSidebar();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(screen.queryByText('Raw Articles')).not.toBeInTheDocument();
    expect(screen.queryByText('AI Config')).not.toBeInTheDocument();
  });

  it('chỉ STAFF (đơn role) vẫn chỉ thấy CRM; chỉ EDITOR không thấy CRM', () => {
    loginWith('STAFF');
    const { unmount } = renderSidebar();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
    expect(screen.queryByText('Raw Articles')).not.toBeInTheDocument();
    expect(screen.queryByText('AI Prompt Config')).not.toBeInTheDocument();
    unmount();

    loginWith('EDITOR');
    renderSidebar();
    expect(screen.queryByText('Quản lý khách hàng')).not.toBeInTheDocument();
    expect(screen.getByText('Raw Articles')).toBeInTheDocument();
  });
});

/** Nút giả lập nút hamburger ở header: mở sidebar mobile qua context. */
const OpenMobileButton = () => {
  const { toggleMobileSidebar } = useSidebar();
  return <button onClick={toggleMobileSidebar}>mở menu</button>;
};

const renderMobileSidebar = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider>
        <OpenMobileButton />
        <AppSidebar />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </SidebarProvider>
    </MemoryRouter>,
  );

const LocationProbe = () => <span data-testid="pathname">{useLocation().pathname}</span>;

const getPanel = () => screen.getByRole('complementary');
// `hidden: true`: khi ngăn kéo đóng, sidebar có aria-hidden (FR-45) nên truy vấn mặc định của RTL không thấy nó.
const getPanelEvenIfHidden = () => screen.getByRole('complementary', { hidden: true });
const isPanelOpen = () => getPanelEvenIfHidden().className.includes('translate-x-0') && !getPanelEvenIfHidden().className.includes('-translate-x-full');

describe('AppSidebar mobile: phủ kín mép trên (PT-024)', () => {
  it('panel neo top-0 + bottom-0 (không còn mt-16 chừa chỗ cho header) và dùng chiều cao dvh', () => {
    loginWith('ADMIN');
    renderSidebar();
    const panel = getPanel();
    expect(panel.className).not.toMatch(/(^|\s)mt-16(\s|$)/);
    expect(panel.className).toContain('inset-y-0');
    expect(panel.className).toContain('h-dvh');
    // Panel phải nằm trên header (z-2) và trên backdrop (z-40).
    expect(panel.className).toContain('z-50');
  });

  it('chừa vùng an toàn (notch/thanh trạng thái iOS) phía trên và dưới panel', () => {
    loginWith('ADMIN');
    renderSidebar();
    expect(getPanel().className).toContain('pt-[env(safe-area-inset-top)]');
    expect(getPanel().className).toContain('pb-[env(safe-area-inset-bottom)]');
  });
});

describe('AppSidebar mobile: đóng sau khi chọn mục (PT-025)', () => {
  it('có nút X đóng menu nằm trong panel, góc phải, chỉ hiện ở mobile (lg:hidden) và bấm thì đóng', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);

    const closeButton = within(getPanel()).getByRole('button', { name: 'Đóng menu' });
    expect(closeButton.className).toContain('right-');
    expect(closeButton.className).toContain('lg:hidden');
    await userEvent.click(closeButton);
    expect(isPanelOpen()).toBe(false);
  });

  it('chạm một mục menu đổi route thì sidebar tự đóng', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);

    await userEvent.click(screen.getByRole('link', { name: /Manage WP/ }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/manage-wp');
    expect(isPanelOpen()).toBe(false);
  });

  it('chạm mục con trong submenu (Knowledge Articles > Config) cũng đóng sidebar', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    await userEvent.click(screen.getByRole('button', { name: /Knowledge Articles/ }));
    // Mở submenu (bấm nút cha) chỉ bung mục con, KHÔNG đóng sidebar.
    expect(isPanelOpen()).toBe(true);

    await userEvent.click(screen.getByRole('link', { name: 'Config' }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/knowledge-config');
    expect(isPanelOpen()).toBe(false);
  });

  it('chạm mục trùng route hiện tại (không đổi route) vẫn đóng sidebar', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));

    await userEvent.click(screen.getByRole('link', { name: /Raw Articles/ }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
    expect(isPanelOpen()).toBe(false);
  });

  it('mở sidebar không tự đóng ngay, và đổi route khi sidebar đang đóng không làm nó mở ra', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    expect(isPanelOpen()).toBe(false);
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Đóng menu' }));
    expect(isPanelOpen()).toBe(false);

    // Điều hướng khi đã đóng (vd desktop): không được bật mở lại.
    await userEvent.click(screen.getByRole('link', { name: /Manage WP/ }));
    expect(isPanelOpen()).toBe(false);
  });

  it('chạm logo (về "/") khi đang ở "/" vẫn đóng sidebar', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);

    await userEvent.click(within(getPanel()).getAllByRole('link')[0]);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
    expect(isPanelOpen()).toBe(false);
  });

  it('chạm logo khi đang ở route khác: về "/" và đóng sidebar', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    await userEvent.click(screen.getByRole('link', { name: /Manage WP/ }));
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);

    await userEvent.click(within(getPanel()).getAllByRole('link')[0]);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
    expect(isPanelOpen()).toBe(false);
  });

  it('mở lại rồi chạm đúng mục của route đang đứng (không phải "/") vẫn đóng, không đóng-mở vòng lặp', async () => {
    loginWith('ADMIN');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    await userEvent.click(screen.getByRole('link', { name: /Manage WP/ }));
    expect(isPanelOpen()).toBe(false);

    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);
    await userEvent.click(screen.getByRole('link', { name: /Manage WP/ }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/manage-wp');
    expect(isPanelOpen()).toBe(false);
  });

  it('điều hướng bằng code (không qua Link của sidebar) khi sidebar đang mở cũng đóng', async () => {
    loginWith('ADMIN');
    const GoButton = () => {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/manage-wp')}>đi bằng code</button>;
    };
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <OpenMobileButton />
          <GoButton />
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);
    await userEvent.click(screen.getByText('đi bằng code'));
    expect(isPanelOpen()).toBe(false);
  });
});

/** Giả lập `matchMedia` theo độ rộng viewport (jsdom không có): chỉ hiểu truy vấn `(max-width: Npx)`. */
const stubViewportWidth = (width: number) => {
  window.matchMedia = ((query: string) => {
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.POSITIVE_INFINITY);
    return {
      matches: width <= maxWidth,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};

describe('AppSidebar: inert + aria-hidden khi ngăn kéo đóng (FR-45, T-58)', () => {
  afterEach(() => {
    // jsdom mặc định không có matchMedia: trả về đúng trạng thái ban đầu cho các test khác.
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('mobile (< lg) và đóng: sidebar có inert + aria-hidden, nút "Đóng menu" không thể focus bằng bàn phím', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderMobileSidebar();
    const panel = screen.getByRole('complementary', { hidden: true });
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    // Phần tử trong sidebar ra khỏi cây truy cập (RTL không tìm thấy khi không bật hidden).
    expect(screen.queryByRole('link', { name: /Manage WP/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đóng menu' })).not.toBeInTheDocument();
    // Tab từ nút mở menu không rơi vào bất kỳ phần tử nào trong sidebar.
    await userEvent.tab();
    expect(panel.contains(document.activeElement)).toBe(false);
  });

  it('mobile mở: bỏ inert + aria-hidden, phần tử trong sidebar thấy được và focus được; đóng lại thì khóa lại', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));

    const panel = getPanel();
    expect(panel).not.toHaveAttribute('inert');
    expect(panel).not.toHaveAttribute('aria-hidden');
    const link = screen.getByRole('link', { name: /Manage WP/ });
    link.focus();
    expect(link).toHaveFocus();

    await userEvent.click(within(panel).getByRole('button', { name: 'Đóng menu' }));
    expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('inert');
    expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  it('dải 768-1023px (md, chưa tới lg) vẫn là ngăn kéo: đóng thì inert', () => {
    loginWith('ADMIN');
    stubViewportWidth(900);
    renderSidebar();
    expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('inert');
  });

  it('desktop (>= lg) không đổi: không inert, không aria-hidden dù isMobileOpen = false', () => {
    loginWith('ADMIN');
    stubViewportWidth(1280);
    renderSidebar();
    const panel = getPanel();
    expect(panel).not.toHaveAttribute('inert');
    expect(panel).not.toHaveAttribute('aria-hidden');
    expect(panel.className).toContain('lg:translate-x-0');
    expect(screen.getByRole('link', { name: /Manage WP/ })).toBeInTheDocument();
  });

  it('môi trường không có matchMedia (SSR/jsdom mặc định) coi như desktop: không inert', () => {
    loginWith('ADMIN');
    renderSidebar();
    expect(getPanel()).not.toHaveAttribute('inert');
  });

  it('chọn một mục khi ngăn kéo đang mở: đổi route, ngăn kéo tự đóng và khóa lại bằng inert + aria-hidden', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    await userEvent.click(screen.getByRole('link', { name: /Manage WP/ }));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/manage-wp');
    expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('inert');
  });
});

describe('AppSidebar: phím Esc đóng ngăn kéo (FR-45, T-58)', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('mobile đang mở: Esc đóng ngăn kéo và áp lại inert + aria-hidden', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);
    expect(getPanel()).not.toHaveAttribute('inert');

    await userEvent.keyboard('{Escape}');

    expect(isPanelOpen()).toBe(false);
    const panel = screen.getByRole('complementary', { hidden: true });
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
  });

  it('phím khác Esc không đóng ngăn kéo', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));

    // Không dùng Enter/Space: focus đang ở nút "mở menu" nên chúng sẽ kích hoạt nút đó chứ không phải thử phím khác Esc.
    await userEvent.keyboard('a{ArrowDown}{ArrowLeft}');

    expect(isPanelOpen()).toBe(true);
  });

  it('Esc khi ngăn kéo đã đóng: không gắn listener và không làm ngăn kéo mở ra (toggle sẽ mở nếu bị gọi nhầm)', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderMobileSidebar();

    await userEvent.keyboard('{Escape}');

    expect(isPanelOpen()).toBe(false);
    expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('inert');
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
  });

  it('Esc đóng xong rồi bấm Esc lần nữa: vẫn đóng, không bật mở lại', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');

    expect(isPanelOpen()).toBe(false);
  });

  it('desktop (>= lg): Esc không làm gì dù cờ mở mobile đang bật, và không gắn listener', async () => {
    loginWith('ADMIN');
    stubViewportWidth(1280);
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderMobileSidebar();
    await userEvent.click(screen.getByText('mở menu'));
    expect(isPanelOpen()).toBe(true);

    await userEvent.keyboard('{Escape}');

    expect(isPanelOpen()).toBe(true);
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
  });

  it('gỡ AppSidebar (unmount) khi ngăn kéo đang mở: Esc sau đó không còn đổi trạng thái mở của context', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    const StateProbe = () => <span data-testid="mobile-open">{String(useSidebar().isMobileOpen)}</span>;
    const Harness = ({ isSidebarMounted }: { isSidebarMounted: boolean }) => (
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <OpenMobileButton />
          <StateProbe />
          {isSidebarMounted && <AppSidebar />}
        </SidebarProvider>
      </MemoryRouter>
    );
    const { rerender } = render(<Harness isSidebarMounted />);
    await userEvent.click(screen.getByText('mở menu'));
    expect(screen.getByTestId('mobile-open')).toHaveTextContent('true');

    rerender(<Harness isSidebarMounted={false} />);
    await userEvent.keyboard('{Escape}');

    // Nếu listener còn sót thì Esc đã gọi toggle và giá trị này thành "false".
    expect(screen.getByTestId('mobile-open')).toHaveTextContent('true');
  });
});

describe('AppSidebar: focus trap, trả focus, closeMobileSidebar, defaultPrevented (T-71)', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  /** Mô phỏng AppHeader (hamburger có `data-sidebar-toggle`), Backdrop thật, một nút ở nội dung phía sau và sidebar. */
  const Harness = ({ shouldHamburgerKeepFocus = true }: { shouldHamburgerKeepFocus?: boolean }) => {
    const { toggleMobileSidebar } = useSidebar();
    return (
      <>
        <button
          data-sidebar-toggle
          onMouseDown={shouldHamburgerKeepFocus ? undefined : (event) => event.preventDefault()}
          onClick={toggleMobileSidebar}
        >
          hamburger
        </button>
        <AppSidebar />
        <Backdrop />
        <button>nội dung phía sau</button>
      </>
    );
  };
  const renderHarness = (props?: { shouldHamburgerKeepFocus?: boolean }) =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <Harness {...props} />
        </SidebarProvider>
      </MemoryRouter>,
    );
  const openDrawer = async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderHarness();
    await userEvent.click(screen.getByText('hamburger'));
  };
  // Dùng chung FOCUSABLE_SELECTOR với production; bỏ phần tử trong vùng inert (vô hình, không Tab tới được).
  const getDrawerFocusables = () => Array.from(getPanel().querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => !element.closest('[inert]'));

  it('mở ngăn kéo: focus vào phần tử focus được đầu tiên của ngăn kéo (nút "Đóng menu")', async () => {
    await openDrawer();
    expect(getDrawerFocusables()[0]).toBe(screen.getByRole('button', { name: 'Đóng menu' }));
    expect(screen.getByRole('button', { name: 'Đóng menu' })).toHaveFocus();
  });

  it('Tab ở phần tử focus cuối quay về phần tử đầu, không rơi ra nội dung phía sau backdrop', async () => {
    await openDrawer();
    const focusables = getDrawerFocusables();
    expect(focusables.length).toBeGreaterThan(2);
    focusables[focusables.length - 1].focus();

    await userEvent.tab();

    expect(focusables[0]).toHaveFocus();
    expect(screen.getByText('nội dung phía sau')).not.toHaveFocus();
  });

  it('Shift+Tab ở phần tử focus đầu nhảy tới phần tử cuối (không ra hamburger phía trước)', async () => {
    await openDrawer();
    const focusables = getDrawerFocusables();
    expect(focusables[0]).toHaveFocus();

    await userEvent.tab({ shift: true });

    expect(focusables[focusables.length - 1]).toHaveFocus();
    expect(screen.getByText('hamburger')).not.toHaveFocus();
  });

  it('Tab ở giữa ngăn kéo vẫn đi tuần tự bình thường (trap không chặn Tab giữa danh sách)', async () => {
    await openDrawer();
    const focusables = getDrawerFocusables();

    await userEvent.tab();

    expect(focusables[1]).toHaveFocus();
  });

  it('focus đã lạc ra ngoài ngăn kéo (vd chạm nền): Tab kéo focus về phần tử đầu của ngăn kéo', async () => {
    await openDrawer();
    screen.getByText('nội dung phía sau').focus();

    await userEvent.tab();

    expect(getDrawerFocusables()[0]).toHaveFocus();
  });

  it('Esc đóng ngăn kéo và trả focus về nút hamburger', async () => {
    await openDrawer();
    expect(screen.getByText('hamburger')).not.toHaveFocus();

    await userEvent.keyboard('{Escape}');

    expect(isPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('hamburger'));
  });

  it('bấm backdrop đóng ngăn kéo và trả focus về nút hamburger', async () => {
    await openDrawer();
    const backdrop = document.querySelector<HTMLElement>('div.fixed.inset-0.z-40');
    expect(backdrop).not.toBeNull();

    await userEvent.click(backdrop as HTMLElement);

    expect(isPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('hamburger'));
  });

  it('hamburger không giữ focus khi chạm (Safari iOS): vẫn trả focus về phần tử [data-sidebar-toggle]', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    renderHarness({ shouldHamburgerKeepFocus: false });
    await userEvent.click(screen.getByText('hamburger'));
    expect(screen.getByRole('button', { name: 'Đóng menu' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    expect(document.activeElement).toBe(screen.getByText('hamburger'));
  });

  it('Esc đã bị phần tử khác xử lý (preventDefault) thì ngăn kéo vẫn mở; Esc không bị chặn thì đóng', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <Harness />
          {/* Giả lập dropdown/modal xử lý Esc của riêng nó (như NotificationDropdown). */}
          <input aria-label="ô giả dropdown" onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()} />
        </SidebarProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText('hamburger'));
    expect(isPanelOpen()).toBe(true);

    screen.getByLabelText('ô giả dropdown').focus();
    await userEvent.keyboard('{Escape}');
    expect(isPanelOpen()).toBe(true);

    // Esc từ phần tử không chặn: đóng bình thường.
    screen.getByText('nội dung phía sau').focus();
    await userEvent.keyboard('{Escape}');
    expect(isPanelOpen()).toBe(false);
  });

  it('closeMobileSidebar tường minh: gọi khi đã đóng vẫn đóng (không đảo như toggle)', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    const CloseTwice = () => {
      const { closeMobileSidebar } = useSidebar();
      return (
        <button
          onClick={() => {
            closeMobileSidebar();
            closeMobileSidebar();
          }}
        >
          đóng hai lần
        </button>
      );
    };
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <Harness />
          <CloseTwice />
        </SidebarProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText('hamburger'));
    expect(isPanelOpen()).toBe(true);

    await userEvent.click(screen.getByText('đóng hai lần'));
    expect(isPanelOpen()).toBe(false);
    // Đã đóng mà gọi tiếp vẫn đóng.
    await userEvent.click(screen.getByText('đóng hai lần'));
    expect(isPanelOpen()).toBe(false);
  });

  /** Chèn một link nằm trong vùng inert ở đầu/cuối panel (mô phỏng link của submenu đóng) để kiểm biên của focus trap. */
  const addInertLink = (position: 'start' | 'end') => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('inert', '');
    wrapper.innerHTML = '<a href="#an">link vô hình</a>';
    if (position === 'start') getPanel().prepend(wrapper);
    else getPanel().append(wrapper);
    return wrapper.querySelector('a') as HTMLElement;
  };

  it('submenu đóng có inert và link con không nằm trong danh sách focus; mở submenu thì gỡ inert', async () => {
    await openDrawer();
    const configLink = screen.getByText('Config', { selector: 'a' });
    expect(configLink.closest('[inert]')).not.toBeNull();
    expect(getDrawerFocusables()).not.toContain(configLink);

    // Submenu mở thì gỡ inert (link tới được). jsdom/user-event không mô phỏng inert khi Tab nên chỉ kiểm thuộc tính.
    await userEvent.click(screen.getByRole('button', { name: /Knowledge Articles/ }));
    expect(screen.getByText('Config', { selector: 'a' }).closest('[inert]')).toBeNull();
    expect(getDrawerFocusables()).toContain(screen.getByText('Config', { selector: 'a' }));
  });

  it('link vô hình ở cuối DOM: Tab ở phần tử cuối NHÌN THẤY quay về đầu, không dừng ở link vô hình', async () => {
    await openDrawer();
    const invisible = addInertLink('end');
    const focusables = getDrawerFocusables();
    expect(focusables).not.toContain(invisible);
    focusables[focusables.length - 1].focus();

    await userEvent.tab();

    expect(focusables[0]).toHaveFocus();
    expect(invisible).not.toHaveFocus();
  });

  it('link vô hình ở đầu DOM: Shift+Tab ở phần tử đầu tới mục cuối NHÌN THẤY', async () => {
    await openDrawer();
    const invisible = addInertLink('start');
    const focusables = getDrawerFocusables();
    expect(focusables).not.toContain(invisible);
    focusables[0].focus();

    await userEvent.tab({ shift: true });

    expect(focusables[focusables.length - 1]).toHaveFocus();
    expect(invisible).not.toHaveFocus();
  });

  it('đóng bằng nút X trả focus về hamburger', async () => {
    await openDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Đóng menu' }));

    expect(isPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('hamburger'));
  });

  it('chọn mục menu (đổi route) đóng ngăn kéo và trả focus về hamburger', async () => {
    await openDrawer();

    await userEvent.click(within(getPanel()).getByRole('link', { name: /Manage WP/ }));

    expect(isPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('hamburger'));
  });

  it('opener đã bị gỡ khỏi DOM khi đóng: không lỗi và không đoạt focus của nơi khác', async () => {
    loginWith('ADMIN');
    stubViewportWidth(390);
    const RemovableOpenerHarness = () => {
      const { toggleMobileSidebar } = useSidebar();
      const [hasOpener, setHasOpener] = useState(true);
      return (
        <>
          {hasOpener && (
            <button data-sidebar-toggle onClick={toggleMobileSidebar}>
              hamburger
            </button>
          )}
          <button onClick={() => setHasOpener(false)}>gỡ hamburger</button>
          <AppSidebar />
        </>
      );
    };
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarProvider>
          <RemovableOpenerHarness />
        </SidebarProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByText('hamburger'));
    expect(isPanelOpen()).toBe(true);
    const removedOpener = screen.getByText('hamburger');
    const removeButton = screen.getByText('gỡ hamburger');
    // Nút "gỡ hamburger" nằm ngoài ngăn kéo (inert không áp dụng khi mở): dùng click để gỡ opener rồi đóng bằng Esc.
    await userEvent.click(removeButton);
    expect(screen.queryByText('hamburger')).toBeNull();
    expect(removedOpener.isConnected).toBe(false);

    // `focus()` trên node đã gỡ không ném lỗi (jsdom/trình duyệt đều no-op) nên không thể dựa vào "không lỗi":
    // spy để khẳng định ngăn kéo không hề gọi focus() trên opener đã gỡ, và focus hiện tại không bị đổi.
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      await userEvent.keyboard('{Escape}');

      const focusedTargets = focusSpy.mock.contexts as unknown[];
      expect(focusedTargets).not.toContain(removedOpener);
    } finally {
      focusSpy.mockRestore();
    }

    expect(isPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(removeButton);
  });

  it('desktop (>= lg): Tab không bị trap (không gắn listener, Tab đi bình thường ra ngoài sidebar)', async () => {
    loginWith('ADMIN');
    stubViewportWidth(1280);
    renderHarness();
    await userEvent.click(screen.getByText('hamburger'));
    const focusables = getDrawerFocusables();
    focusables[focusables.length - 1].focus();

    await userEvent.tab();

    expect(screen.getByText('nội dung phía sau')).toHaveFocus();
  });
});
