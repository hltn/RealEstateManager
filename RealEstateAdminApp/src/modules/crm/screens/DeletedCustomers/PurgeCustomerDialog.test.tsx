import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PurgeCustomerDialog, isPurgeConfirmed } from './PurgeCustomerDialog';

const customer = { id: 'c1', fullName: 'Nguyễn Văn An', phoneMasked: '0912 ••• 678' };

describe('PurgeCustomerDialog xác nhận 2 bước', () => {
  it('bước 1 nêu KHÔNG hoàn tác + dữ liệu sẽ mất + SĐT được giải phóng; bước 2 chỉ bật nút khi gõ đúng XOA', () => {
    const onConfirm = vi.fn();
    render(<PurgeCustomerDialog customer={customer} isSubmitting={false} error={null} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText(/KHÔNG THỂ HOÀN TÁC/)).toBeInTheDocument();
    expect(screen.getByText('Nhật ký chăm sóc')).toBeInTheDocument();
    expect(screen.getByText(/Ảnh và tệp đính kèm/)).toBeInTheDocument();
    expect(screen.getByText('Lịch hẹn')).toBeInTheDocument();
    expect(screen.getByText(/giải phóng/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xóa vĩnh viễn' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tôi hiểu, tiếp tục' }));
    const confirm = screen.getByRole('button', { name: 'Xóa vĩnh viễn' });
    expect(confirm).toBeDisabled();
    const box = screen.getByLabelText(/Gõ/);
    fireEvent.change(box, { target: { value: 'XO' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(box, { target: { value: ' xoa ' } });
    expect(confirm).toBeEnabled();
    fireEvent.change(box, { target: { value: 'Xóa' } });
    expect(confirm).toBeEnabled();
    expect(screen.getByText(/Gõ/)).toHaveTextContent('XOA hoặc XÓA');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('bước 2 (đã sang bước gõ xác nhận) nhấp nền KHÔNG đóng hộp; Esc và Huỷ vẫn đóng; bước 1 nhấp nền đóng', () => {
    const onCancel = vi.fn();
    render(<PurgeCustomerDialog customer={customer} isSubmitting={false} error={null} onConfirm={vi.fn()} onCancel={onCancel} />);
    const backdrop = () => screen.getByRole('alertdialog').parentElement?.parentElement?.previousElementSibling as HTMLElement;
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/KHÔNG THỂ HOÀN TÁC/);
    fireEvent.click(backdrop());
    expect(onCancel).toHaveBeenCalledTimes(1);

    onCancel.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Tôi hiểu, tiếp tục' }));
    fireEvent.click(backdrop());
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('isPurgeConfirmed bỏ khoảng trắng và hoa/thường nhưng không nhận từ khác', () => {
    expect(isPurgeConfirmed('XOA')).toBe(true);
    expect(isPurgeConfirmed(' xóa ')).toBe(true);
    expect(isPurgeConfirmed('XÓA'.normalize('NFD'))).toBe(true);
    // Chỉ nhận đúng XOA / XÓA: biến thể dấu khác, ký tự thừa hay xen kẽ đều không.
    for (const typed of ['XÓA!', 'XOAX', 'X O A', 'XÒA', 'XOẠ', 'xỏa', 'XOÁ', '']) expect(isPurgeConfirmed(typed), typed).toBe(false);
    expect(isPurgeConfirmed('Nguyễn Văn An')).toBe(false);
  });
});
