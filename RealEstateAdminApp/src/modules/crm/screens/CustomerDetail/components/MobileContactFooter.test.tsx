import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileContactFooter } from './MobileContactFooter';

const callCustomer = vi.fn();
const messageZalo = vi.fn();

vi.mock('@crm/hooks/useContactActions', () => ({
  useContactActions: () => ({ callCustomer, messageZalo, openQuickNote: vi.fn() }),
}));

const renderFooter = () => {
  const onAddNote = vi.fn();
  render(<MobileContactFooter customerId="c1" hasPhone onAddNote={onAddNote} />);
  return { onAddNote };
};

beforeEach(() => {
  callCustomer.mockReset();
  messageZalo.mockReset();
});

describe('MobileContactFooter (PT-028): thanh đáy Ghi chú / Gọi điện / Nhắn Zalo', () => {
  it('có đúng 3 nút theo thứ tự Ghi chú, Gọi điện, Nhắn Zalo, cùng cao h-12 (bấm một tay)', () => {
    renderFooter();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Ghi chú', 'Gọi điện', 'Nhắn Zalo']);
    buttons.forEach((button) => expect(button).toHaveClass('h-12'));
  });

  it('"Ghi chú" là nút phụ vừa nội dung (không giãn), hai nút liên hệ chia đều phần còn lại, chữ không xuống dòng', () => {
    renderFooter();
    expect(screen.getByRole('button', { name: 'Ghi chú' })).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(screen.getByRole('button', { name: 'Ghi chú' })).not.toHaveClass('flex-1');
    expect(screen.getByRole('button', { name: 'Gọi điện' })).toHaveClass('flex-1');
    expect(screen.getByRole('button', { name: 'Nhắn Zalo' })).toHaveClass('flex-1');
  });

  it('bấm "Ghi chú" gọi onAddNote đúng 1 lần và KHÔNG gọi/nhắn khách', () => {
    const { onAddNote } = renderFooter();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(callCustomer).not.toHaveBeenCalled();
    expect(messageZalo).not.toHaveBeenCalled();
  });

  it('bấm Gọi điện / Nhắn Zalo vẫn gọi đúng hành động liên hệ với khách đang xem, không mở form ghi chú', () => {
    const { onAddNote } = renderFooter();
    fireEvent.click(screen.getByRole('button', { name: 'Gọi điện' }));
    expect(callCustomer).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: 'Nhắn Zalo' }));
    expect(messageZalo).toHaveBeenCalledWith('c1');
    expect(onAddNote).not.toHaveBeenCalled();
  });
});
