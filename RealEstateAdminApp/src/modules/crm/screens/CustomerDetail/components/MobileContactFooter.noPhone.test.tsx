/** MobileContactFooter: khách chưa có SĐT (FR-02) thì ẨN nút Gọi/Zalo (không disable). */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileContactFooter } from './MobileContactFooter';

const callCustomer = vi.fn();
const messageZalo = vi.fn();

vi.mock('@crm/hooks/useContactActions', () => ({ useContactActions: () => ({ callCustomer, messageZalo, openQuickNote: vi.fn() }) }));

describe('MobileContactFooter: khách chưa có SĐT', () => {
  it('chỉ còn "Ghi chú" (vẫn bấm được); không có Gọi điện / Nhắn Zalo (kể cả dạng disabled)', () => {
    const onAddNote = vi.fn();
    render(<MobileContactFooter customerId="c1" hasPhone={false} onAddNote={onAddNote} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Ghi chú']);
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(callCustomer).not.toHaveBeenCalled();
    expect(messageZalo).not.toHaveBeenCalled();
  });
});
