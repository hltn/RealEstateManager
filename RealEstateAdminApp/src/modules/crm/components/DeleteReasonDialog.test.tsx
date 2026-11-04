import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteReasonDialog } from './DeleteReasonDialog';

const setup = (props: Partial<Parameters<typeof DeleteReasonDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<DeleteReasonDialog isOpen title="Xóa 2 khách?" description="Mô tả" confirmLabel="Xóa 2 khách" onConfirm={onConfirm} onCancel={onCancel} {...props} />);
  return { onConfirm, onCancel };
};

const reasonBox = () => screen.getByLabelText(/Lý do xóa/);

describe('DeleteReasonDialog', () => {
  it('nút Xóa chỉ bật khi lý do hợp lệ; gửi lý do đã cắt khoảng trắng; có đếm ký tự', () => {
    const { onConfirm } = setup();
    const confirm = screen.getByRole('button', { name: 'Xóa 2 khách' });
    expect(confirm).toBeDisabled();

    fireEvent.change(reasonBox(), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reasonBox(), { target: { value: '  Khách trùng  ' } });
    expect(screen.getByText('15/500')).toBeInTheDocument();
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Khách trùng');
  });

  it('giới hạn 500 ký tự ở ô nhập; lỗi của lần trước hiện trong hộp và giữ nguyên lý do', () => {
    setup({ error: 'Vượt quá 200 khách' });
    expect(reasonBox()).toHaveAttribute('maxlength', '500');
    expect(screen.getByRole('alert')).toHaveTextContent('Vượt quá 200 khách');
  });

  it('đã nhập lý do thì nhấp nền KHÔNG đóng hộp (khỏi mất chữ đang gõ); Esc và Huỷ vẫn đóng; chưa nhập thì nhấp nền đóng', () => {
    const { onCancel } = setup();
    const backdrop = () => screen.getByRole('alertdialog').parentElement?.parentElement?.previousElementSibling as HTMLElement;
    fireEvent.click(backdrop());
    expect(onCancel).toHaveBeenCalledTimes(1);

    onCancel.mockClear();
    fireEvent.change(reasonBox(), { target: { value: 'Đang gõ dở' } });
    fireEvent.click(backdrop());
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('tiêu điểm vào ô lý do khi mở và Tab xoay vòng trong hộp (không rơi ra ngoài)', () => {
    setup();
    expect(reasonBox()).toHaveFocus();
    fireEvent.change(reasonBox(), { target: { value: 'x' } });
    screen.getByRole('button', { name: 'Xóa 2 khách' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(reasonBox()).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Xóa 2 khách' })).toHaveFocus();
  });
});
