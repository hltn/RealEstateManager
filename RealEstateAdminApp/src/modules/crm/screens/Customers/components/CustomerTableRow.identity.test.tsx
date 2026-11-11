/** CustomerTableRow: mã KH cạnh SĐT (FR-04, FR-02) và ô "Người chăm sóc chính" chỉ khi được bật (FR-17). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';
import { makeListItem } from '@crm/test/listItemFactory';

vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: vi.fn() }) }));
vi.mock('@crm/components/TableContactActions', () => ({ TableContactActions: () => null }));

import { CustomerTableRow } from './CustomerTableRow';

const renderRow = (item: CustomerListItem, isShowingPrimaryAssignee?: boolean) =>
  render(
    <table>
      <tbody>
        <CustomerTableRow customer={item} isSelected={false} onToggleSelect={vi.fn()} isShowingPrimaryAssignee={isShowingPrimaryAssignee} />
      </tbody>
    </table>,
  );

describe('CustomerTableRow - mã khách cạnh SĐT', () => {
  it('có cả mã lẫn SĐT: cùng một dòng, mã trước SĐT, có dấu "·" ở giữa', () => {
    renderRow(makeListItem({ customerCode: 'KH-000123' }));
    const code = screen.getByText('KH-000123');
    const phone = screen.getByText('0912 ••• 678');
    expect(code.closest('p')).toBe(phone.closest('p'));
    expect(code.closest('p')?.textContent).toBe('Mã khách KH-000123·0912 ••• 678');
    expect(code.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('khách KHÔNG có SĐT: chỉ hiện mã, không dấu phân cách thừa, không chữ "null"', () => {
    renderRow(makeListItem({ customerCode: 'KH-000124', phoneMasked: null }));
    expect(screen.getByText('KH-000124').closest('p')?.textContent).toBe('Mã khách KH-000124');
    expect(screen.queryByText('·')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it.each(['', '   '])('SĐT là chuỗi rỗng/khoảng trắng (%j): coi như không có SĐT, chỉ hiện mã, không dấu phân cách', (phoneMasked) => {
    renderRow(makeListItem({ customerCode: 'KH-000125', phoneMasked }));
    expect(screen.getByText('KH-000125').closest('p')?.textContent).toBe('Mã khách KH-000125');
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('mã null (khách cũ) + có SĐT: chỉ hiện SĐT, không dấu phân cách', () => {
    renderRow(makeListItem({ customerCode: null }));
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
    expect(screen.getByText('0912 ••• 678').closest('p')?.textContent).toBe('0912 ••• 678');
  });

  it('không mã và không SĐT: không render dòng định danh rỗng', () => {
    renderRow(makeListItem({ customerCode: null, phoneMasked: null }));
    expect(document.querySelector('td p')).toBeNull();
  });

  it('mã dài hơn 6 số hiển thị đúng', () => {
    renderRow(makeListItem({ customerCode: 'KH-1000000' }));
    expect(screen.getByText('KH-1000000')).toHaveTextContent('KH-1000000');
  });
});

describe('CustomerTableRow - ô "Người chăm sóc chính" (chỉ Quản trị/Quản lý)', () => {
  const withAssignee = (isLocked?: boolean) => makeListItem({ primaryAssignee: { id: 'u1', displayName: 'Lan Chủ Khách', isLocked }, careTeamSize: 3 });

  it('mặc định (Nhân viên): không hiện tên người chăm sóc chính, không "đã khóa", không "Chưa phân"', () => {
    renderRow(withAssignee(true));
    expect(screen.queryByText('Lan Chủ Khách')).not.toBeInTheDocument();
    expect(screen.queryByText('đã khóa')).not.toBeInTheDocument();
    expect(screen.queryByText('Chưa phân')).not.toBeInTheDocument();
  });

  it('bật cờ: hiện tên + số thành viên phụ; tài khoản bị khóa có nhãn "đã khóa"', () => {
    renderRow(withAssignee(true), true);
    expect(screen.getByText('Lan Chủ Khách')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('đã khóa')).toBeInTheDocument();
  });

  it('bật cờ, tài khoản chưa khóa: không có "đã khóa"; không có người chính: "Chưa phân"', () => {
    const { unmount } = renderRow(withAssignee(false), true);
    expect(screen.queryByText('đã khóa')).not.toBeInTheDocument();
    unmount();
    renderRow(makeListItem({ primaryAssignee: null }), true);
    expect(screen.getByText('Chưa phân')).toBeInTheDocument();
  });

  it('bật cờ: hàng có đủ 10 ô (ô chọn + 9 cột)', () => {
    const { container } = renderRow(makeListItem(), true);
    expect(container.querySelectorAll('td')).toHaveLength(10);
  });
});
