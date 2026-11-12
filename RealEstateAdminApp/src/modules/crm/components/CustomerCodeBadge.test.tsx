import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CustomerCodeBadge } from './CustomerCodeBadge';

describe('CustomerCodeBadge', () => {
  it('có mã -> hiện mã, font-mono tabular-nums', () => {
    render(<CustomerCodeBadge code="KH-000123" />);
    const badge = screen.getByText('KH-000123');
    expect(badge).toHaveTextContent('KH-000123');
    expect(badge).toHaveClass('font-mono', 'tabular-nums');
  });

  it('trợ năng: nhãn "Mã khách" là chữ ẩn thị giác nằm TRONG nội dung (không dùng aria-label trên span không role)', () => {
    const { container } = render(<CustomerCodeBadge code="KH-000123" />);
    expect(container.firstElementChild).not.toHaveAttribute('aria-label');
    expect(screen.getByText('Mã khách')).toHaveClass('sr-only');
    expect(container.textContent).toBe('Mã khách KH-000123');
  });

  it('mã null / undefined / rỗng -> không render gì', () => {
    const { container, rerender } = render(<CustomerCodeBadge code={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CustomerCodeBadge code={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CustomerCodeBadge code="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mã dài hơn 6 số vẫn hiển thị nguyên vẹn', () => {
    render(<CustomerCodeBadge code="KH-1000000" />);
    expect(screen.getByText('KH-1000000')).toHaveTextContent('KH-1000000');
  });

  it('nhận thêm className', () => {
    render(<CustomerCodeBadge code="KH-000001" className="text-gray-500" />);
    expect(screen.getByText('KH-000001')).toHaveClass('text-gray-500', 'font-mono');
  });
});
