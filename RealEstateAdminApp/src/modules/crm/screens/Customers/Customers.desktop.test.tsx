/**
 * Tích hợp xóa hàng loạt ở màn danh sách khách: hộp kết quả nằm ở cấp màn (không trong thanh chọn) nên vẫn hiện
 * khi thanh chọn biến mất vì mọi khách còn lại đều đã bị bỏ chọn.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

const bulkOperation = vi.fn();
const currentRole = vi.hoisted(() => ({ value: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'STAFF' }));
const customers = ['c1', 'c2', 'c3'].map(
  (id) => ({ id, fullName: `Khách ${id}`, status: { id: 'DROPPED', listGroup: 'DROPPED' }, primaryAssignee: null }) as unknown as CustomerListItem,
);

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCrmApi: () => ({ bulkOperation }),
    useCrmActor: () => ({ userId: 'admin', role: currentRole.value, teamId: null, managedTeamIds: [] }),
    useCatalogs: () => ({ catalogs: { statuses: [], tags: [] }, users: [] }),
    useCareTeamInvitees: () => ({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } }),
    usePersonaFieldMap: () => new Map(),
  };
});
vi.mock('@crm/api/mockHooks', async () => ({ ...(await vi.importActual<object>('@crm/api/mockHooks')), useCustomerExport: () => vi.fn() }));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ navigate: vi.fn(), showToast: vi.fn(), resetFilters: vi.fn() }) }));
vi.mock('@crm/components/CrmModuleTabs', () => ({ CrmModuleTabs: () => null }));
vi.mock('./components/CustomerToolbar', () => ({ CustomerToolbar: () => null }));
vi.mock('./components/CustomerStatusPills', () => ({ CustomerStatusPills: () => null }));
vi.mock('./components/CustomerTableRow', () => ({
  CustomerTableRow: ({
    customer,
    isSelected,
    onToggleSelect,
    isShowingPrimaryAssignee,
  }: {
    customer: CustomerListItem;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
    isShowingPrimaryAssignee?: boolean;
  }) => (
    <tr data-primary-assignee={String(Boolean(isShowingPrimaryAssignee))}>
      <td>
        <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(customer.id)} aria-label={`Chọn ${customer.fullName}`} />
      </td>
    </tr>
  ),
}));
vi.mock('./useCustomerListScreen', async () => {
  const { DEFAULT_FILTERS } = await import('@crm/store/crmReducer');
  return {
  useCustomerListScreen: () => ({
    list: { data: customers, meta: { total: 3, page: 1, limit: 10, totalPages: 1 } },
    counts: { ALL: 3 },
    filters: { ...DEFAULT_FILTERS, listGroup: 'DROPPED' },
    query: {},
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    updateFilters: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
  }),
  };
});

import { CustomersDesktop } from './Customers.desktop';

beforeEach(() => {
  bulkOperation.mockReset();
  currentRole.value = 'ADMIN';
});

describe('CustomersDesktop - xóa hàng loạt', () => {
  it('3 khách chọn: 2 xóa được + 1 CUSTOMER_NOT_FOUND -> thanh chọn biến mất nhưng hộp kết quả VẪN hiện đủ từng khách; đóng hộp thì tiêu điểm về vùng danh sách', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c1', 'c2'], failed: [{ customerId: 'c3', errorCode: 'CUSTOMER_NOT_FOUND' }] } });
    render(<CustomersDesktop />);
    for (const customer of customers) fireEvent.click(screen.getByRole('checkbox', { name: `Chọn ${customer.fullName}` }));
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Khách trùng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa 3 khách' }));

    const dialog = await screen.findByRole('dialog', { name: 'Kết quả xóa khách' });
    expect(dialog).toHaveTextContent('Khách c3');
    expect(dialog).toHaveTextContent('không còn trong phạm vi');
    expect(dialog).toHaveTextContent('Khách c1');
    expect(dialog).not.toHaveTextContent('vẫn đang được chọn');
    // Không còn khách nào được chọn nên thanh hành động hàng loạt đã biến mất.
    expect(screen.queryByLabelText('Hành động hàng loạt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kết quả xóa khách' })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(document.querySelector('[data-focus-fallback]'));
  });

  it('Quản trị: cột "Hẹn" không còn; có cột "Người chăm sóc chính" đúng thứ tự; hàng nhận cờ hiện cột', () => {
    render(<CustomersDesktop />);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).not.toContain('Hẹn');
    expect(headers.slice(1)).toEqual(['Khách hàng', 'Tình trạng', 'Dự án', 'Nguồn', 'Khu vực', 'Tiến độ', 'Người chăm sóc chính', 'Cập nhật', 'Thao tác']);
    document.querySelectorAll('tbody tr').forEach((row) => expect(row).toHaveAttribute('data-primary-assignee', 'true'));
  });

  it('Quản lý cũng thấy cột "Người chăm sóc chính"', () => {
    currentRole.value = 'MANAGER';
    render(<CustomersDesktop />);
    expect(screen.getByRole('columnheader', { name: 'Người chăm sóc chính' })).toBeInTheDocument();
  });

  it('Nhân viên KHÔNG thấy cột "Người chăm sóc chính" (cũng không còn cột "Phụ trách"); hàng không nhận cờ', () => {
    currentRole.value = 'STAFF';
    render(<CustomersDesktop />);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.slice(1)).toEqual(['Khách hàng', 'Tình trạng', 'Dự án', 'Nguồn', 'Khu vực', 'Tiến độ', 'Cập nhật', 'Thao tác']);
    expect(screen.queryByText(/Phụ trách|chăm sóc chính/i)).not.toBeInTheDocument();
    document.querySelectorAll('tbody tr').forEach((row) => expect(row).toHaveAttribute('data-primary-assignee', 'false'));
  });
});
