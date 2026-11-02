import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmBreadcrumb } from './CrmBreadcrumb';

const renderBreadcrumb = (items: Parameters<typeof CrmBreadcrumb>[0]['items']) =>
  render(
    <MemoryRouter>
      <CrmBreadcrumb items={items} />
    </MemoryRouter>,
  );

/** `<li>` chứa nhãn (nhãn nằm trong <a>/<span>). */
const itemOf = (label: string): HTMLElement => screen.getByText(label).closest('li') as HTMLElement;

describe('CrmBreadcrumb (PT-017: ẩn tên khách trên mobile)', () => {
  it('mục thường: luôn hiện (flex), không có lớp ẩn trên mobile', () => {
    renderBreadcrumb([{ label: 'Quản lý khách hàng', to: '/crm/customers' }, { label: 'Nguyễn Văn A' }]);
    expect(itemOf('Quản lý khách hàng').className).not.toMatch(/\bhidden\b/);
    expect(itemOf('Nguyễn Văn A').className).not.toMatch(/\bhidden\b/);
  });

  it('mục đánh dấu shouldHideOnMobile: ẩn dưới md (hidden) và hiện lại từ md (md:flex), desktop giữ nguyên', () => {
    renderBreadcrumb([{ label: 'Quản lý khách hàng', to: '/crm/customers' }, { label: 'Nguyễn Văn A', shouldHideOnMobile: true }]);
    const nameItem = itemOf('Nguyễn Văn A');
    expect(nameItem).toHaveClass('hidden', 'md:flex');
    expect(nameItem).not.toHaveClass('flex');
    // Vẫn còn trong DOM cho desktop/tablet.
    expect(screen.getByText('Nguyễn Văn A')).toHaveAttribute('aria-current', 'page');
  });

  it('mũi tên liền trước mục bị ẩn cũng ẩn trên mobile; mũi tên khác giữ nguyên', () => {
    renderBreadcrumb([
      { label: 'Quản lý khách hàng', to: '/crm/customers' },
      { label: 'Nguyễn Văn A', to: '/crm/customers/1', shouldHideOnMobile: true },
      { label: 'Chỉnh sửa' },
    ]);
    const firstArrow = itemOf('Quản lý khách hàng').querySelector('svg');
    const secondArrow = itemOf('Nguyễn Văn A').querySelector('svg');
    expect(firstArrow).toHaveClass('hidden', 'md:block');
    // Mũi tên sau tên khách dẫn tới "Chỉnh sửa" (không ẩn) nên vẫn hiện: mobile còn "Quản lý khách hàng > Chỉnh sửa".
    expect(secondArrow).not.toHaveClass('hidden');
  });

  it('danh sách rỗng: không vẽ gì', () => {
    const { container } = renderBreadcrumb([]);
    expect(container).toBeEmptyDOMElement();
  });
});
