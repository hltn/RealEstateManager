/**
 * Kiểm cả chuỗi response thô của backend -> mapper -> hook `useDeletedCustomers` -> màn hình (chỉ mock tầng HTTP),
 * để cờ `purgeInProgress` của DTO thật sự làm nút Khôi phục bị vô hiệu.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));
vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCrmApi: () => ({}) };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast: vi.fn() }) }));
vi.mock('@crm/components/CrmModuleTabs', () => ({ CrmModuleTabs: () => null }));

import { DeletedCustomersView } from './DeletedCustomersView';

const dto = (id: string, fullName: string, purgeInProgress: boolean) => ({
  id,
  fullName,
  phoneMasked: '0912 ••• 678',
  status: { id: 's', code: 'DROPPED', label: 'Bỏ', listGroup: 'DROPPED', color: 'error' },
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 0,
  criteriaDone: {},
  primaryAssignee: null,
  careTeamSize: 1,
  nextAppointmentAt: null,
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-28T00:00:00.000Z',
  personaCompleteness: 0,
  deletedAt: '2026-10-28T03:00:00.000Z',
  deletedBy: { id: 'a', displayName: 'Admin' },
  anonymizedAt: null,
  deleteReason: 'Trùng',
  purgeInProgress,
});

describe('DeletedCustomersView với response thật của API', () => {
  it('purgeInProgress=true từ backend: nhãn "đang xóa dở" + Khôi phục bị vô hiệu, Xóa vĩnh viễn vẫn bật; khách thường khôi phục được', async () => {
    request.mockResolvedValue({ data: { data: [dto('c1', 'Khách Dở Dang', true), dto('c2', 'Khách Bình Thường', false)], meta: { total: 2, page: 1, limit: 10, totalPages: 1 } } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DeletedCustomersView variant="desktop" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Đang xóa dở — bấm Xóa vĩnh viễn để hoàn tất')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Khôi phục Khách Dở Dang' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xóa vĩnh viễn Khách Dở Dang' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Khôi phục Khách Bình Thường' })).toBeEnabled();
  });
});
