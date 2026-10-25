import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../../stores/auth.store';
import { getDefaultAppointmentWindow, useCrmActor } from './hooks';
import { canBulkAssign, canExportCustomers, canImportCustomers, canManageProjects, canViewProjectCatalog, canViewReports, canViewSettings } from './access';

const login = (role: 'ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF', extra: { teamId?: string | null; managedTeamIds?: string[] } = {}) =>
  useAuthStore.getState().setAuth('token', { _id: 'u1', email: 'a@b.vn', displayName: 'A', role, ...extra });

beforeEach(() => useAuthStore.getState().clearAuth());

describe('useCrmActor: người dùng thật từ /auth/me', () => {
  it('Quản lý mang nhóm quản lý; tham chiếu ổn định khi store đổi phần không liên quan', () => {
    login('MANAGER', { teamId: 't1', managedTeamIds: ['t1', 't2'] });
    const { result, rerender } = renderHook(() => useCrmActor());
    const first = result.current;
    expect(first).toEqual({ userId: 'u1', role: 'MANAGER', teamId: 't1', managedTeamIds: ['t1', 't2'] });
    useAuthStore.getState().markInitialized();
    rerender();
    expect(result.current).toBe(first);
  });

  it('vai trò không có quyền CRM (EDITOR) hoặc chưa đăng nhập -> coi như Nhân viên (ít quyền nhất)', () => {
    login('EDITOR');
    expect(renderHook(() => useCrmActor()).result.current.role).toBe('STAFF');
  });
});

describe('quyền hiển thị theo vai trò (02 §3, 04 §4.2) — chỉ là UX, backend mới là nguồn sự thật', () => {
  it('ma trận Quản trị / Quản lý / Nhân viên', () => {
    expect([canViewReports('ADMIN'), canViewReports('MANAGER'), canViewReports('STAFF')]).toEqual([true, true, false]);
    expect([canViewSettings('ADMIN'), canViewSettings('MANAGER'), canViewSettings('STAFF')]).toEqual([true, false, false]);
    expect([canViewProjectCatalog('ADMIN'), canViewProjectCatalog('STAFF')]).toEqual([true, false]);
    expect([canManageProjects('ADMIN'), canManageProjects('MANAGER')]).toEqual([true, false]);
    expect([canExportCustomers('MANAGER'), canExportCustomers('STAFF')]).toEqual([true, false]);
    expect([canImportCustomers('ADMIN'), canImportCustomers('MANAGER')]).toEqual([true, false]);
    expect([canBulkAssign('MANAGER'), canBulkAssign('STAFF')]).toEqual([true, false]);
  });
});

describe('cửa sổ lịch hẹn mặc định', () => {
  it('14 ngày trước tới 45 ngày sau hôm nay (VN), ≤ 62 ngày như backend', () => {
    const window = getDefaultAppointmentWindow(new Date('2026-10-25T00:00:00.000Z'));
    expect(window).toEqual({ from: '2026-10-11', to: '2026-12-09' });
    const spanDays = (Date.parse(window.to) - Date.parse(window.from)) / 86_400_000;
    expect(spanDays).toBeLessThanOrEqual(62);
  });
});
