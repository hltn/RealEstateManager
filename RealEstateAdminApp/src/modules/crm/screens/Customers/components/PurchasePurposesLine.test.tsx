import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PurchasePurposesLine } from './PurchasePurposesLine';

describe('PurchasePurposesLine', () => {
  it('hiện các mục đích cách nhau dấu phẩy trên một dòng, cắt "…" khi dài và có title đủ nội dung', () => {
    const { container } = render(<PurchasePurposesLine purposes={['LIVING', 'INVEST_RENT']} />);
    const text = screen.getByText('Ở thực, Đầu tư cho thuê');
    expect(text).toHaveClass('truncate');
    expect(container.querySelector('p')).toHaveAttribute('title', 'Mục đích mua: Ở thực, Đầu tư cho thuê');
  });

  it('dịch mã theo cấu hình trường được truyền vào', () => {
    render(<PurchasePurposesLine purposes={['LIVING']} field={{ optionItems: [{ value: 'LIVING', label: 'Để ở', isActive: true }] }} />);
    expect(screen.getByText('Để ở')).toBeInTheDocument();
  });

  it('mã lạ hiện nguyên mã', () => {
    render(<PurchasePurposesLine purposes={['X_Y']} />);
    expect(screen.getByText('X_Y')).toBeInTheDocument();
  });

  it('rỗng -> không render dòng nào (không chừa khoảng trống)', () => {
    const { container } = render(<PurchasePurposesLine purposes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
