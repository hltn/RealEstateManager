/**
 * T-20: `useCatalogs` không còn `assignable`/`users`; `useAssigneeFilterOptions` lấy người từ `GET /crm/customer-assignees`
 * (không còn `assignable-users`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth.store';

const list = vi.fn();
const get = vi.fn();
vi.mock('./http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/crmHttp')>()),
  crmHttp: { list: (...args: unknown[]) => list(...args), get: (...args: unknown[]) => get(...args), raw: vi.fn() },
}));

import { useAssigneeFilterOptions, useCatalogs } from './hooks';

const emptyPage = { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } };

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

beforeEach(() => {
  list.mockReset();
  get.mockReset();
  list.mockResolvedValue(emptyPage);
  get.mockResolvedValue({});
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.getState().clearAuth();
  useAuthStore.getState().setAuth('token', { _id: 'u1', email: 'a@b.vn', displayName: 'Hạnh', role: 'STAFF' });
});

describe('useCatalogs', () => {
  it('kết quả không có `assignable`/`users`, danh mục không có khóa người dùng; không gọi assignable-users', async () => {
    const { result } = renderHook(() => useCatalogs(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).not.toHaveProperty('users');
    expect(result.current).not.toHaveProperty('assignable');
    expect(Object.keys(result.current.catalogs).sort()).toEqual(['areas', 'contactResults', 'leadSources', 'projects', 'statuses', 'tags']);
    expect(list.mock.calls.map((call) => call[0])).not.toContain('/crm/assignable-users');
  });
});

describe('useAssigneeFilterOptions', () => {
  it('gọi GET /crm/customer-assignees (không gọi assignable-users) và đưa người trả về vào lựa chọn', async () => {
    list.mockImplementation(async (url: string) =>
      url === '/crm/customer-assignees' ? { data: [{ id: 'u2', displayName: 'Minh', role: 'STAFF', team: null, teams: [], isLocked: true }], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } } : emptyPage,
    );
    const { result } = renderHook(() => useAssigneeFilterOptions(), { wrapper });
    await waitFor(() => expect(JSON.stringify(result.current)).toContain('u2'));
    const urls = list.mock.calls.map((call) => call[0]);
    expect(urls).toContain('/crm/customer-assignees');
    expect(urls).not.toContain('/crm/assignable-users');
  });
});
