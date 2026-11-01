import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isPrototypeEnabled: true } }));

import { SidebarProvider } from '../context/SidebarContext';
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
