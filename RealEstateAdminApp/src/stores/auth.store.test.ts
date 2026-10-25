import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '../queryClient';
import type { AuthUser } from '../types/user';
import { useAuthStore } from './auth.store';

const user = (id: string): AuthUser => ({ _id: id, email: `${id}@x.vn`, displayName: id, role: 'STAFF' });

beforeEach(() => {
  queryClient.clear();
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: false });
});

describe('cache React Query không lộ dữ liệu giữa các người dùng', () => {
  it('đăng xuất / refresh thất bại (clearAuth) xóa toàn bộ cache', () => {
    useAuthStore.getState().setAuth('t', user('a'));
    queryClient.setQueryData(['crm', 'data', 'customers'], [{ fullName: 'Khách của A' }]);
    useAuthStore.getState().clearAuth();
    expect(queryClient.getQueryData(['crm', 'data', 'customers'])).toBeUndefined();
  });

  it('đăng nhập sang tài khoản KHÁC (không qua đăng xuất) cũng xóa cache; cùng tài khoản (refresh token) thì giữ', () => {
    useAuthStore.getState().setAuth('t1', user('a'));
    queryClient.setQueryData(['k'], 1);
    useAuthStore.getState().setAuth('t2', user('a'));
    expect(queryClient.getQueryData(['k'])).toBe(1);
    useAuthStore.getState().setAuth('t3', user('b'));
    expect(queryClient.getQueryData(['k'])).toBeUndefined();
  });

  it('setUser khác id (khôi phục phiên) cũng xóa cache; user đầu tiên (chưa có ai) không xóa', () => {
    queryClient.setQueryData(['k'], 1);
    useAuthStore.getState().setUser(user('a'));
    expect(queryClient.getQueryData(['k'])).toBe(1);
    useAuthStore.getState().setUser(user('b'));
    expect(queryClient.getQueryData(['k'])).toBeUndefined();
  });
});
