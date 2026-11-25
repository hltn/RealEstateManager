/** ContactActionGrid / TableContactActions: khách chưa có SĐT thì ẨN (không disable) nút Gọi/Zalo (FR-02). */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactActionGrid } from './ContactActionGrid';
import { TableContactActions } from './TableContactActions';

const contact = vi.hoisted(() => ({ callCustomer: vi.fn(), messageZalo: vi.fn(), openQuickNote: vi.fn() }));
const crm = vi.hoisted(() => ({ selectCustomer: vi.fn() }));
vi.mock('@crm/hooks/useContactActions', () => ({ useContactActions: () => contact }));
vi.mock('@crm/store', () => ({ useCrmActions: () => crm }));

describe('ContactActionGrid', () => {
  it('có SĐT: đủ 4 nút Gọi · Zalo · Ghi chú · Xem', () => {
    render(<ContactActionGrid customerId="c1" hasPhone />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Gọi', 'Zalo', 'Ghi chú', 'Xem']);
  });

  it('không SĐT: không có nút Gọi/Zalo (không phải disabled), còn Ghi chú và Xem hoạt động', () => {
    render(<ContactActionGrid customerId="c1" hasPhone={false} />);
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    expect(contact.openQuickNote).toHaveBeenCalledWith('c1');
    expect(crm.selectCustomer).toHaveBeenCalledWith('c1');
  });

  it('lưới 4 cột chỉ khi đủ 4 nút; không SĐT thì 2 cột (không lệch lưới)', () => {
    const { container, rerender } = render(<ContactActionGrid customerId="c1" hasPhone columns={4} />);
    expect(container.firstElementChild).toHaveClass('grid-cols-4');
    rerender(<ContactActionGrid customerId="c1" hasPhone={false} columns={4} />);
    expect(container.firstElementChild).toHaveClass('grid-cols-2');
  });
});

describe('TableContactActions', () => {
  it('có SĐT: Gọi, Zalo và Ghi chú nhanh', () => {
    render(<TableContactActions customerId="c1" customerName="Nguyễn Văn An" hasPhone />);
    expect(screen.getByRole('button', { name: 'Gọi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zalo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú nhanh cho Nguyễn Văn An' })).toBeInTheDocument();
  });

  it('không SĐT: ẩn Gọi/Zalo, vẫn còn Ghi chú nhanh', () => {
    render(<TableContactActions customerId="c1" customerName="Nguyễn Văn An" hasPhone={false} />);
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú nhanh cho Nguyễn Văn An' })).toBeInTheDocument();
  });
});
