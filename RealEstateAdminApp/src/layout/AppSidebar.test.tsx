import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isPrototypeEnabled: true } }));

import { SidebarProvider, useSidebar } from '../context/SidebarContext';
import { useAuthStore } from '../stores/auth.store';
import type { UserRole } from '../types/user';
import AppSidebar from './AppSidebar';

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
const isPanelOpen = () => getPanel().className.includes('translate-x-0') && !getPanel().className.includes('-translate-x-full');

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
