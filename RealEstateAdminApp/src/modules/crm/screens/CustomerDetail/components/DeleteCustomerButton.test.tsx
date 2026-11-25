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

const customer = (canDelete: boolean) => ({ id: 'c1', fullName: 'Nguyễn Văn An', permissions: { canDelete } }) as Parameters<typeof DeleteCustomerButton>[0]['customer'];

beforeEach(() => {
  api.deleteCustomer.mockReset();
  navigate.mockReset();
  showToast.mockReset();
});

describe('DeleteCustomerButton', () => {
  it('FR-31: chỉ theo cờ backend permissions.canDelete (Quản trị hoặc người tạo), KHÔNG phụ thuộc tình trạng khách "Bỏ"', () => {
    const { rerender } = render(<DeleteCustomerButton customer={customer(false)} variant="desktop" />);
    expect(screen.queryByRole('button', { name: 'Xóa khách' })).not.toBeInTheDocument();
    rerender(<DeleteCustomerButton customer={customer(true)} variant="desktop" />);
    expect(screen.getByRole('button', { name: 'Xóa khách' })).toBeInTheDocument();
    rerender(<DeleteCustomerButton customer={{ ...customer(true), status: { listGroup: 'INTERESTED' } } as never} variant="mobile" />);
    expect(screen.getByRole('button', { name: 'Xóa khách' })).toBeInTheDocument();
    expect(screen.queryByText(/danh sách Bỏ/)).not.toBeInTheDocument();
  });

  it('hủy hộp rồi mở lại thì không còn thấy lỗi của lần trước', async () => {
    api.deleteCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'x' } });
    render(<DeleteCustomerButton customer={customer(true)} variant="desktop" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa khách' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Khách trùng' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa khách' }).at(-1) as HTMLElement);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa khách' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('xóa cần lý do; 403 INSUFFICIENT_ROLE nói chỉ Quản trị hoặc người tạo; thành công thì báo và quay về danh sách khách', async () => {
    api.deleteCustomer.mockResolvedValueOnce({ ok: false, error: { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'x' } });
    render(<DeleteCustomerButton customer={customer(true)} variant="mobile" />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa khách' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Khách trùng' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa khách' }).at(-1) as HTMLElement);
    expect(await screen.findByRole('alert')).toHaveTextContent('Quản trị hoặc người tạo khách');
    expect(navigate).not.toHaveBeenCalled();

    api.deleteCustomer.mockResolvedValueOnce({ ok: true, data: undefined });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa khách' }).at(-1) as HTMLElement);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('customers'));
    expect(api.deleteCustomer).toHaveBeenLastCalledWith('c1', 'Khách trùng');
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã xóa khách Nguyễn Văn An' }));
  });

  it('mobile: kiểu kín đáo (đường kẻ phía trên, chữ đỏ, không nền đỏ đặc); desktop vẫn là nút icon viền', () => {
    const { container, rerender } = render(<DeleteCustomerButton customer={customer(true)} variant="mobile" />);
    const mobileButton = screen.getByRole('button', { name: 'Xóa khách' });
    expect(container.firstElementChild).toHaveClass('border-t');
    expect(mobileButton).toHaveClass('text-error-600');
    expect(mobileButton.className).not.toMatch(/(^|\s)bg-error-(500|600)/);
    expect(mobileButton).not.toHaveClass('col-span-2');
    rerender(<DeleteCustomerButton customer={customer(true)} variant="desktop" />);
    expect(screen.getByRole('button', { name: 'Xóa khách' })).toHaveAttribute('title', 'Xóa khách');
    expect(container.querySelector('.border-t')).toBeNull();
  });

  it('mobile không quyền xóa: không render gì (kể cả đường kẻ)', () => {
    const { container } = render(<DeleteCustomerButton customer={customer(false)} variant="mobile" />);
    expect(container).toBeEmptyDOMElement();
  });
});
