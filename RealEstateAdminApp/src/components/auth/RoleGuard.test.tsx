import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { UserRole } from '../../types/user';
import RoleGuard from './RoleGuard';

const login = (role: (typeof UserRole)[keyof typeof UserRole]) => useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role }, isInitialized: true });

const renderGuarded = () =>
  render(
    <MemoryRouter initialEntries={['/manage-wp']}>
      <Routes>
        <Route path="/crm/today" element={<p>MÀN CRM</p>} />
        <Route
          path="/manage-wp"
          element={
            <RoleGuard allowedRoles={[UserRole.ADMIN, UserRole.EDITOR]} fallback={<p>KHÔNG CÓ QUYỀN</p>}>
              <p>TRANG TIN TỨC</p>
            </RoleGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => useAuthStore.setState({ accessToken: null, user: null, isInitialized: true }));

describe('RoleGuard route tin tức', () => {
  it('ADMIN/EDITOR vào được', () => {
    login(UserRole.EDITOR);
    renderGuarded();
    expect(screen.getByText('TRANG TIN TỨC')).toBeInTheDocument();
  });

  it('MANAGER/STAFF gõ URL trực tiếp bị chuyển về /crm/today', () => {
    login(UserRole.STAFF);
    renderGuarded();
    expect(screen.getByText('MÀN CRM')).toBeInTheDocument();
    expect(screen.queryByText('TRANG TIN TỨC')).toBeNull();
  });
});
