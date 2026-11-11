import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: vi.fn() }) }));
vi.mock('@crm/components/TableContactActions', () => ({ TableContactActions: () => null }));

import { CustomerTableRow } from './CustomerTableRow';

const customer = (overrides: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c1',
  customerCode: 'KH-000001',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  purchasePurposes: [],
  status: { id: 'NOT_CONTACTED', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray' },
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 0,
  criteriaDone: { demand: false, motivation: false, finance: false, timing: false },
  primaryAssignee: null,
  careTeamSize: 0,
  nextAppointmentAt: '2099-01-01T02:00:00.000Z',
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-24T01:00:00.000Z',
  personaCompleteness: 0,
  ...overrides,
});

const renderRow = (item: CustomerListItem, purchasePurposeField?: { optionItems: { value: string; label: string; isActive: boolean }[] }) =>
  render(
    <table>
      <tbody>
        <CustomerTableRow customer={item} isSelected={false} onToggleSelect={vi.fn()} purchasePurposeField={purchasePurposeField} />
      </tbody>
    </table>,
  );

describe('CustomerTableRow - nền khi hover / đã chọn', () => {
  const renderWithSelection = (isSelected: boolean) =>
    render(
      <table>
        <tbody>
          <CustomerTableRow customer={customer()} isSelected={isSelected} onToggleSelect={vi.fn()} />
        </tbody>
      </table>,
    ).container.querySelector('tr') as HTMLTableRowElement;

  it('hàng thường: hover đổi nền xám, chưa có nền brand', () => {
    const row = renderWithSelection(false);
    expect(row).toHaveClass('hover:bg-gray-200', 'dark:hover:bg-white/[0.08]', 'transition-colors');
    expect(row).not.toHaveClass('bg-brand-50');
    expect(row).not.toHaveClass('hover:bg-brand-100');
  });

  it('hàng đã chọn: giữ nền brand, hover đậm hơn một nấc và không lẫn lớp hover của hàng thường', () => {
    const row = renderWithSelection(true);
    expect(row).toHaveClass('bg-brand-50', 'hover:bg-brand-100', 'dark:bg-brand-500/[0.10]', 'dark:hover:bg-brand-500/[0.20]');
    expect(row).not.toHaveClass('hover:bg-gray-200');
    expect(row).not.toHaveClass('dark:hover:bg-white/[0.08]');
  });

  it('đổi isSelected khi rerender: không sót lớp của trạng thái cũ (cả hai chiều)', () => {
    const tree = (isSelected: boolean) => (
      <table>
        <tbody>
          <CustomerTableRow customer={customer()} isSelected={isSelected} onToggleSelect={vi.fn()} />
        </tbody>
      </table>
    );
    const selectedClasses = ['bg-brand-50', 'hover:bg-brand-100', 'dark:bg-brand-500/[0.10]', 'dark:hover:bg-brand-500/[0.20]'];
    const plainClasses = ['hover:bg-gray-200', 'dark:hover:bg-white/[0.08]'];
    const { container, rerender } = render(tree(true));
    const row = container.querySelector('tr') as HTMLTableRowElement;

    rerender(tree(false));
    expect(row).toHaveClass(...plainClasses);
    // Từng lớp một: `not.toHaveClass(a, b)` chỉ cần thiếu 1 lớp là qua, không đủ chặt.
    selectedClasses.forEach((cls) => expect(row).not.toHaveClass(cls));

    rerender(tree(true));
    expect(row).toHaveClass(...selectedClasses);
    plainClasses.forEach((cls) => expect(row).not.toHaveClass(cls));
  });
});

describe('CustomerTableRow - mục đích mua dưới SĐT', () => {
  it('hiện mục đích mua (nhãn, cách dấu phẩy) ngay sau dòng SĐT trong ô Khách hàng', () => {
    renderRow(customer({ purchasePurposes: ['LIVING', 'INVEST_RENT'] }));
    const phone = screen.getByText('0912 ••• 678');
    const purposes = screen.getByText('Ở thực, Đầu tư cho thuê');
    expect(phone.closest('td')).toBe(purposes.closest('td'));
    expect(phone.closest('p')?.nextElementSibling).toBe(purposes.closest('p'));
  });

  it('dùng nhãn theo cấu hình trường khi có', () => {
    renderRow(customer({ purchasePurposes: ['LIVING'] }), { optionItems: [{ value: 'LIVING', label: 'Để ở', isActive: true }] });
    expect(screen.getByText('Để ở')).toBeInTheDocument();
  });

  it('không có mục đích -> không có dòng mục đích', () => {
    renderRow(customer());
    expect(screen.queryByTitle(/Mục đích mua/)).not.toBeInTheDocument();
    expect(screen.getByText('0912 ••• 678').closest('p')?.nextElementSibling?.tagName).toBe('DIV');
  });

  it('không còn ô "Hẹn": hàng chỉ có ô chọn + 9 cột còn lại, không hiện thời điểm hẹn', () => {
    const { container } = renderRow(customer());
    expect(container.querySelectorAll('td')).toHaveLength(10);
    expect(screen.queryByText(/ngày nữa|giờ nữa|2099/i)).not.toBeInTheDocument();
  });
});
