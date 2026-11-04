import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../stores/auth.store';
import { UserRole } from '../../types/user';
import RoleGuard from './RoleGuard';

const login = (role: (typeof UserRole)[keyof typeof UserRole], roles?: (typeof UserRole)[keyof typeof UserRole][]) =>
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u', email: 'a@b.vn', displayName: 'A', role, roles }, isInitialized: true });

const renderGuarded = (allowedRoles: UserRole[] = [UserRole.ADMIN, UserRole.EDITOR]) =>
  render(
    <MemoryRouter initialEntries={['/manage-wp']}>
      <Routes>
        <Route path="/crm/today" element={<p>MÀN CRM</p>} />
        <Route
          path="/manage-wp"
          element={
            <RoleGuard allowedRoles={allowedRoles} fallback={<p>KHÔNG CÓ QUYỀN</p>}>
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

  it('nhiều role: STAFF+EDITOR vào được (chỉ cần MỘT role khớp)', () => {
    login(UserRole.STAFF, [UserRole.STAFF, UserRole.EDITOR]);
    renderGuarded();
    expect(screen.getByText('TRANG TIN TỨC')).toBeInTheDocument();
  });

  it('roles[] được ưu tiên hơn role đơn: role đơn EDITOR nhưng roles chỉ có STAFF thì KHÔNG vào được', () => {
    login(UserRole.EDITOR, [UserRole.STAFF]);
    renderGuarded();
    expect(screen.queryByText('TRANG TIN TỨC')).toBeNull();
    expect(screen.getByText('MÀN CRM')).toBeInTheDocument();
  });

  it('STAFF+EDITOR gõ URL chỉ-ADMIN: không đủ quyền nên được chuyển về /crm/today', () => {
    login(UserRole.STAFF, [UserRole.STAFF, UserRole.EDITOR]);
    renderGuarded([UserRole.ADMIN]);
    expect(screen.getByText('MÀN CRM')).toBeInTheDocument();
  });

  it('MANAGER/STAFF gõ URL trực tiếp bị chuyển về /crm/today', () => {
    login(UserRole.STAFF);
    renderGuarded();
    expect(screen.getByText('MÀN CRM')).toBeInTheDocument();
    expect(screen.queryByText('TRANG TIN TỨC')).toBeNull();
  });
});
