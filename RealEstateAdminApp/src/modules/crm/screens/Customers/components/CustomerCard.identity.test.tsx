/** CustomerCard: mã KH cạnh SĐT (FR-04, FR-02) và dòng "Chăm sóc" chỉ khi được bật (FR-17). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeListItem } from '@crm/test/listItemFactory';

vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: vi.fn() }) }));
vi.mock('@crm/components/ContactActionGrid', () => ({ ContactActionGrid: () => null }));

import { CustomerCard } from './CustomerCard';

describe('CustomerCard - mã khách cạnh SĐT', () => {
  it('có cả mã lẫn SĐT: cùng một dòng, mã trước SĐT, có dấu "·" ở giữa', () => {
    render(<CustomerCard customer={makeListItem({ customerCode: 'KH-000123' })} />);
    expect(screen.getByText('KH-000123').closest('p')?.textContent).toBe('Mã khách KH-000123·0912 ••• 678');
  });

  it('khách KHÔNG có SĐT: chỉ hiện mã, không dấu phân cách thừa, không chữ "null"', () => {
    render(<CustomerCard customer={makeListItem({ customerCode: 'KH-000124', phoneMasked: null })} />);
    expect(screen.getByText('KH-000124').closest('p')?.textContent).toBe('Mã khách KH-000124');
    expect(screen.queryByText('·')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it.each(['', '   '])('SĐT là chuỗi rỗng/khoảng trắng (%j): coi như không có SĐT, chỉ hiện mã, không dấu phân cách', (phoneMasked) => {
    render(<CustomerCard customer={makeListItem({ customerCode: 'KH-000125', phoneMasked })} />);
    expect(screen.getByText('KH-000125').closest('p')?.textContent).toBe('Mã khách KH-000125');
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('mã null + không SĐT: không có dòng định danh', () => {
    render(<CustomerCard customer={makeListItem({ customerCode: null, phoneMasked: null })} />);
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
    expect(document.querySelector('article > div p')).toBeNull();
  });
});

describe('CustomerCard - dòng "Chăm sóc" (chỉ Quản trị/Quản lý)', () => {
  const locked = makeListItem({ primaryAssignee: { id: 'u1', displayName: 'Lan Chủ Khách', isLocked: true }, careTeamSize: 2 });

  it('mặc định (Nhân viên): không hiện người chăm sóc chính; ô hẹn chiếm cả hàng', () => {
    render(<CustomerCard customer={locked} />);
    expect(screen.queryByText('Chăm sóc:')).not.toBeInTheDocument();
    expect(screen.queryByText('Lan Chủ Khách')).not.toBeInTheDocument();
    expect(screen.getByText('Hẹn tiếp theo').parentElement).toHaveClass('col-span-2');
  });

  it('bật cờ: "Chăm sóc: <tên> (đã khóa)" + số thành viên phụ', () => {
    render(<CustomerCard customer={locked} isShowingPrimaryAssignee />);
    expect(screen.getByText('Chăm sóc:')).toBeInTheDocument();
    expect(screen.getByText('Lan Chủ Khách')).toBeInTheDocument();
    expect(screen.getByText('(đã khóa)')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('bật cờ, chưa khóa: không có "(đã khóa)"; chưa có người chính: "Chưa phân"', () => {
    const { unmount } = render(<CustomerCard customer={makeListItem({ primaryAssignee: { id: 'u1', displayName: 'Lan' } })} isShowingPrimaryAssignee />);
    expect(screen.queryByText('(đã khóa)')).not.toBeInTheDocument();
    unmount();
    render(<CustomerCard customer={makeListItem({ primaryAssignee: null })} isShowingPrimaryAssignee />);
    expect(screen.getByText('Chưa phân')).toBeInTheDocument();
  });
});
