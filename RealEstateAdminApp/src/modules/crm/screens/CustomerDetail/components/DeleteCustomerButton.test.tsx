import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteCustomerButton } from './DeleteCustomerButton';

const api = { deleteCustomer: vi.fn() };
const navigate = vi.fn();
const showToast = vi.fn();

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCrmApi: () => api };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ navigate, showToast }) }));

const customer = (listGroup: 'DROPPED' | 'INTERESTED', canDelete: boolean) =>
  ({ id: 'c1', fullName: 'Nguyễn Văn An', status: { listGroup }, permissions: { canDelete } }) as Parameters<typeof DeleteCustomerButton>[0]['customer'];

beforeEach(() => {
  api.deleteCustomer.mockReset();
  navigate.mockReset();
  showToast.mockReset();
});

describe('DeleteCustomerButton', () => {
  it('chỉ hiện khi khách thuộc "Bỏ" VÀ backend cho phép xóa (permissions.canDelete)', () => {
    const { rerender } = render(<DeleteCustomerButton customer={customer('INTERESTED', true)} variant="desktop" />);
    expect(screen.queryByRole('button', { name: 'Xóa khách' })).not.toBeInTheDocument();
    rerender(<DeleteCustomerButton customer={customer('DROPPED', false)} variant="desktop" />);
    expect(screen.queryByRole('button', { name: 'Xóa khách' })).not.toBeInTheDocument();
    rerender(<DeleteCustomerButton customer={customer('DROPPED', true)} variant="desktop" />);
    expect(screen.getByRole('button', { name: 'Xóa khách' })).toBeInTheDocument();
  });

  it('hủy hộp rồi mở lại thì không còn thấy lỗi của lần trước', async () => {
    api.deleteCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 409, errorCode: 'CUSTOMER_NOT_DROPPED', message: 'x' } });
    render(<DeleteCustomerButton customer={customer('DROPPED', true)} variant="desktop" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa khách' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Khách trùng' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa khách' }).at(-1) as HTMLElement);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa khách' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('xóa cần lý do; 409 CUSTOMER_NOT_DROPPED hiện trong hộp; thành công thì báo và quay về danh sách khách', async () => {
    api.deleteCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 409, errorCode: 'CUSTOMER_NOT_DROPPED', message: 'x' } });
    render(<DeleteCustomerButton customer={customer('DROPPED', true)} variant="mobile" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa khách' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Khách trùng' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa khách' }).at(-1) as HTMLElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('chưa thuộc danh sách Bỏ');
    expect(navigate).not.toHaveBeenCalled();

    api.deleteCustomer.mockResolvedValueOnce({ ok: true, data: undefined });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa khách' }).at(-1) as HTMLElement);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('customers'));
    expect(api.deleteCustomer).toHaveBeenLastCalledWith('c1', 'Khách trùng');
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã xóa khách Nguyễn Văn An' }));
  });
});
