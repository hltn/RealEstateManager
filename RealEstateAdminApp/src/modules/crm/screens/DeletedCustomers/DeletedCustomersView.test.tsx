import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletedCustomerItem } from '@crm/api';
import { DeletedCustomersView } from './DeletedCustomersView';

const api = { restoreCustomer: vi.fn(), purgeDeletedCustomer: vi.fn() };
const showToast = vi.fn();
let items: DeletedCustomerItem[] = [];
let meta = { total: 0, page: 1, limit: 10, totalPages: 0 };
const useDeletedCustomers = vi.fn();

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCrmApi: () => api, useDeletedCustomers: (query: unknown) => useDeletedCustomers(query) };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));
vi.mock('@crm/components/CrmModuleTabs', () => ({ CrmModuleTabs: () => null }));

const make = (patch: Partial<DeletedCustomerItem>): DeletedCustomerItem =>
  ({
    id: 'c1',
    fullName: 'Nguyễn Văn An',
    phoneMasked: '0912 ••• 678',
    deletedAt: '2026-10-28T03:00:00.000Z',
    deletedBy: { id: 'a', displayName: 'Admin E2E' },
    anonymizedAt: null,
    deleteReason: 'Khách trùng',
    purgeInProgress: false,
    ...patch,
  }) as DeletedCustomerItem;

const setList = (list: DeletedCustomerItem[], nextMeta = { total: list.length, page: 1, limit: 10, totalPages: list.length > 0 ? 1 : 0 }) => {
  items = list;
  meta = nextMeta;
};

const renderView = () => render(<DeletedCustomersView variant="desktop" />);
const row = (name: string) => screen.getAllByRole('listitem').find((item) => within(item).queryByText(name)) as HTMLElement;
const purgeUntilConfirmed = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Xóa vĩnh viễn ${name}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Tôi hiểu, tiếp tục' }));
  fireEvent.change(screen.getByLabelText(/Gõ/), { target: { value: 'XOA' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  showToast.mockReset();
  useDeletedCustomers.mockReset().mockImplementation(() => ({ data: { data: items, meta }, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() }));
  setList([make({})]);
});

describe('DeletedCustomersView', () => {
  it('hiện tên, SĐT che, ngày + người xóa, lý do; khách ẩn danh hóa (lý do null) và khách đang xóa dở hiển thị đúng và KHÔNG khôi phục được', () => {
    setList([
      make({}),
      make({ id: 'c2', fullName: 'Khách Ẩn Danh', anonymizedAt: '2026-10-29T00:00:00.000Z', deleteReason: null }),
      make({ id: 'c3', fullName: 'Khách Dở Dang', purgeInProgress: true }),
    ]);
    renderView();
    expect(row('Nguyễn Văn An')).toHaveTextContent('Lý do: Khách trùng');
    expect(row('Nguyễn Văn An')).toHaveTextContent('bởi Admin E2E');
    expect(row('Nguyễn Văn An')).toHaveTextContent('0912 ••• 678');
    expect(screen.getByRole('button', { name: 'Khôi phục Nguyễn Văn An' })).toBeEnabled();

    expect(row('Khách Ẩn Danh')).toHaveTextContent('Đã ẩn danh hóa');
    expect(row('Khách Ẩn Danh')).toHaveTextContent('Lý do xóa đã được ẩn');
    expect(screen.getByRole('button', { name: 'Khôi phục Khách Ẩn Danh' })).toBeDisabled();

    expect(row('Khách Dở Dang')).toHaveTextContent('Đang xóa dở — bấm Xóa vĩnh viễn để hoàn tất');
    expect(screen.getByRole('button', { name: 'Khôi phục Khách Dở Dang' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xóa vĩnh viễn Khách Dở Dang' })).toBeEnabled();
  });

  it('trạng thái rỗng', () => {
    setList([]);
    renderView();
    expect(screen.getByText('Chưa có khách nào bị xóa.')).toBeInTheDocument();
  });

  it('khôi phục: xác nhận nhẹ rồi gọi API; lỗi 409 CUSTOMER_PURGE_IN_PROGRESS được giải thích và hộp còn mở', async () => {
    api.restoreCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 409, errorCode: 'CUSTOMER_PURGE_IN_PROGRESS', message: 'x' } });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục Nguyễn Văn An' }));
    expect(api.restoreCustomer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('xóa vĩnh viễn dở dang');

    api.restoreCustomer.mockResolvedValueOnce({ ok: true, data: { id: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã khôi phục khách Nguyễn Văn An' })));
    expect(api.restoreCustomer).toHaveBeenCalledWith('c1');
  });

  it('xóa vĩnh viễn thành công: nêu số dữ liệu đã dọn; 503 giữ hộp mở báo CHƯA xóa gì và bấm lại được', async () => {
    api.purgeDeletedCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message: 'x' } });
    renderView();
    purgeUntilConfirmed('Nguyễn Văn An');
    expect(await screen.findByRole('alert')).toHaveTextContent('CHƯA xóa gì');
    expect(showToast).not.toHaveBeenCalled();

    api.purgeDeletedCustomer.mockResolvedValueOnce({ ok: true, data: { customerId: 'c1', purged: { careLogs: 3, attachments: 1, files: 1, appointments: 0, careTeamRequests: 0, reminders: 0, notifications: 0, auditLogs: 5 } } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ title: 'Đã xóa vĩnh viễn khách Nguyễn Văn An', message: 'Đã dọn 3 nhật ký, 1 ảnh, 1 tệp. Số điện thoại đã được giải phóng.' }));
    expect(api.purgeDeletedCustomer).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('404 sau khi bấm xóa vĩnh viễn được coi là đã xong (đóng hộp, không báo lỗi)', async () => {
    api.purgeDeletedCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 404, errorCode: 'CUSTOMER_NOT_FOUND', message: 'x' } });
    renderView();
    purgeUntilConfirmed('Nguyễn Văn An');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Khách Nguyễn Văn An đã được xóa vĩnh viễn' })));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('xóa khách duy nhất của trang cuối thì lùi về trang trước', async () => {
    setList([make({})], { total: 21, page: 3, limit: 10, totalPages: 3 });
    api.purgeDeletedCustomer.mockResolvedValue({ ok: true, data: { customerId: 'c1', purged: { careLogs: 0, attachments: 0, files: 0, appointments: 0, careTeamRequests: 0, reminders: 0, notifications: 0, auditLogs: 0 } } });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Trang 3' }));
    expect(useDeletedCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));

    purgeUntilConfirmed('Nguyễn Văn An');
    await waitFor(() => expect(useDeletedCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });
});
