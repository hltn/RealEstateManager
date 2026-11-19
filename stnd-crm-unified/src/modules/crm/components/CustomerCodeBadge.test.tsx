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

  it('chế độ mặc định không đổi: chữ thuần, KHÔNG có button, KHÔNG có icon', () => {
    const { container } = render(<CustomerCodeBadge code="KH-000053" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('Mã khách KH-000053');
  });

  it('isCopyable: là nút sao chép có aria-label, KHÔNG còn chữ sr-only "Mã khách" trong nút (tránh đọc trùng)', () => {
    const { container } = render(<CustomerCodeBadge code="KH-000053" isCopyable />);
    expect(screen.getByRole('button', { name: 'Sao chép mã khách KH-000053' })).toBeInTheDocument();
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it.each([null, undefined, ''])('isCopyable với mã %j: không render gì', (code) => {
    const { container } = render(<CustomerCodeBadge code={code} isCopyable />);
    expect(container).toBeEmptyDOMElement();
  });

  it('isCopyable với mã dài hơn 6 số: hiện nguyên vẹn', () => {
    render(<CustomerCodeBadge code="KH-1000000" isCopyable />);
    expect(screen.getByRole('button')).toHaveTextContent('KH-1000000');
  });
});
