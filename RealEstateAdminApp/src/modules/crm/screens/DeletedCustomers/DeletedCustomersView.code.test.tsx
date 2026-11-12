/** DeletedCustomersView: mã khách ở từng dòng (FR-04); khách không SĐT / mã null không lỗi. */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeletedCustomerItem } from '@crm/api';
import { DeletedCustomersView } from './DeletedCustomersView';

let items: DeletedCustomerItem[] = [];

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCrmApi: () => ({ restoreCustomer: vi.fn(), purgeDeletedCustomer: vi.fn() }),
    useDeletedCustomers: () => ({
      data: { data: items, meta: { total: items.length, page: 1, limit: 10, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast: vi.fn() }) }));
vi.mock('@crm/components/CrmModuleTabs', () => ({ CrmModuleTabs: () => null }));

const make = (patch: Partial<DeletedCustomerItem>): DeletedCustomerItem =>
  ({
    id: 'c1',
    customerCode: 'KH-000123',
    fullName: 'Nguyễn Văn An',
    phoneMasked: '0912 ••• 678',
    deletedAt: '2026-10-28T03:00:00.000Z',
    deletedBy: { id: 'a', displayName: 'Admin' },
    anonymizedAt: null,
    deleteReason: 'Khách trùng',
    purgeInProgress: false,
    ...patch,
  }) as DeletedCustomerItem;

describe('DeletedCustomersView - mã khách', () => {
  it('hiện mã KH cạnh tên và SĐT của từng khách đã xóa', () => {
    items = [make({}), make({ id: 'c2', fullName: 'Lê Thị B', customerCode: 'KH-1000000', phoneMasked: null })];
    render(<DeletedCustomersView variant="desktop" />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('KH-000123')).toBeInTheDocument();
    expect(within(rows[1]).getByText('KH-1000000')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Chưa có SĐT')).toBeInTheDocument();
  });

  it('mã null: không hiện mã, vẫn hiện tên', () => {
    items = [make({ customerCode: null })];
    render(<DeletedCustomersView variant="desktop" />);
    expect(screen.getByText('Nguyễn Văn An')).toBeInTheDocument();
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
  });
});
