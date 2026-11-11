/**
 * `useCareTeamInvitees` (FR-14, T-20): khóa query `['crm','care-team-invitees', customerId, q, page]`, `keepPreviousData`,
 * có thể tắt (`isEnabled`), và `invalidateCrm` làm mới khóa này.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmApiException } from './http/crmErrors';
import type { CareTeamInvitee, Paginated } from './types';

const fetchCareTeamInvitees = vi.fn();
vi.mock('./http/careApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('./http/careApi')>()), fetchCareTeamInvitees: (...args: unknown[]) => fetchCareTeamInvitees(...args) }));

import { invalidateCrm, useCareTeamInvitees } from './hooks';

const page = (names: string[]): Paginated<CareTeamInvitee> => ({
  data: names.map((name) => ({ id: name, displayName: name, teamNames: [] })),
  meta: { total: names.length, page: 1, limit: 20, totalPages: 1 },
});

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

beforeEach(() => {
  fetchCareTeamInvitees.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

describe('useCareTeamInvitees', () => {
  it('khóa query là ["crm","care-team-invitees", customerId, q, page] và gọi API với đúng tham số', async () => {
    fetchCareTeamInvitees.mockResolvedValue(page(['An']));
    const { result } = renderHook(() => useCareTeamInvitees('c1', 'an', 2), { wrapper });
    await waitFor(() => expect(result.current.data.data).toHaveLength(1));
    expect(queryClient.getQueryCache().find({ queryKey: ['crm', 'care-team-invitees', 'c1', 'an', 2], exact: true })).toBeDefined();
    expect(fetchCareTeamInvitees.mock.calls[0][0]).toEqual({ customerId: 'c1', q: 'an', page: 2 });
  });

  it('không có customerId (thao tác hàng loạt): khóa mang undefined, tham số không có customerId', async () => {
    fetchCareTeamInvitees.mockResolvedValue(page([]));
    const { result } = renderHook(() => useCareTeamInvitees(undefined, '', 1), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(queryClient.getQueryCache().find({ queryKey: ['crm', 'care-team-invitees', undefined, '', 1], exact: true })).toBeDefined();
    expect(fetchCareTeamInvitees.mock.calls[0][0].customerId).toBeUndefined();
  });

  it('keepPreviousData: đổi q thì dữ liệu cũ vẫn hiển thị trong lúc tải trang mới (không nhấp nháy rỗng)', async () => {
    let resolveSecond: (value: Paginated<CareTeamInvitee>) => void = () => undefined;
    fetchCareTeamInvitees.mockResolvedValueOnce(page(['An'])).mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));
    const { result, rerender } = renderHook(({ q }) => useCareTeamInvitees('c1', q, 1), { wrapper, initialProps: { q: 'a' } });
    await waitFor(() => expect(result.current.data.data.map((item) => item.id)).toEqual(['An']));

    rerender({ q: 'ab' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data.data.map((item) => item.id)).toEqual(['An']);

    await act(async () => resolveSecond(page(['Bình'])));
    await waitFor(() => expect(result.current.data.data.map((item) => item.id)).toEqual(['Bình']));
  });

  it('isEnabled=false: không gọi API, trả trang rỗng', () => {
    const { result } = renderHook(() => useCareTeamInvitees('c1', '', 1, false), { wrapper });
    expect(fetchCareTeamInvitees).not.toHaveBeenCalled();
    expect(result.current.data.data).toEqual([]);
    expect(result.current.data.meta.total).toBe(0);
  });

  it('lỗi API: isError và data vẫn là trang rỗng', async () => {
    fetchCareTeamInvitees.mockRejectedValue(new CrmApiException({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'x' }));
    const { result } = renderHook(() => useCareTeamInvitees('c1', '', 1), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data.data).toEqual([]);
  });

  it('invalidateCrm làm mới khóa care-team-invitees (nằm ngoài crmKeys.data)', async () => {
    fetchCareTeamInvitees.mockResolvedValue(page(['An']));
    const { result } = renderHook(() => useCareTeamInvitees('c1', '', 1), { wrapper });
    await waitFor(() => expect(result.current.data.data).toHaveLength(1));
    expect(fetchCareTeamInvitees).toHaveBeenCalledTimes(1);
    await act(async () => invalidateCrm(queryClient));
    await waitFor(() => expect(fetchCareTeamInvitees).toHaveBeenCalledTimes(2));
  });
});
