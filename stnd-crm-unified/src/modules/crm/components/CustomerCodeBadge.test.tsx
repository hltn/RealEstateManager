import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CustomerCodeBadge } from './CustomerCodeBadge';

describe('CustomerCodeBadge', () => {
  it('có mã: hiện đúng mã, font-mono; tiền tố "Mã khách" nằm trong nội dung chữ (sr-only) để trình đọc màn hình đọc được', () => {
    render(<CustomerCodeBadge code="KH-000123" />);
    const badge = screen.getByText('KH-000123');
    expect(badge).toHaveClass('font-mono');
    expect(badge).toHaveTextContent('Mã khách KH-000123');
    expect(screen.getByText('Mã khách')).toHaveClass('sr-only');
    expect(badge).not.toHaveAttribute('aria-label');
  });

  it('mã dài hơn 6 chữ số (vượt 999999) vẫn hiện đủ, không cắt', () => {
    render(<CustomerCodeBadge code="KH-1000000" />);
    expect(screen.getByText('KH-1000000')).toHaveTextContent('Mã khách KH-1000000');
  });

  it.each([[null], [undefined], ['']])('mã %j: không render gì (không để lại khoảng trống)', (code) => {
    const { container } = render(<CustomerCodeBadge code={code} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nhận className bổ sung', () => {
    render(<CustomerCodeBadge code="KH-000001" className="ml-2" />);
    expect(screen.getByText('KH-000001')).toHaveClass('ml-2');
  });
});
