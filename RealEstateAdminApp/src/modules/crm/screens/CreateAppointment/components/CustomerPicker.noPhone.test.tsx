/** CustomerPicker / CustomerFields: khách chưa có SĐT hiển thị bình thường, không chữ "null", không dấu phân cách thừa (FR-02). */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerDetail, CustomerListItem } from '@crm/api';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { CustomerFields } from './AppointmentFormFields';
import { CustomerPicker } from './CustomerPicker';

const status = { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' };
const make = (id: string, fullName: string, phoneMasked: string | null) => ({ id, fullName, phoneMasked, status, projects: [], careTeam: [], primaryAssignee: null }) as unknown as CustomerListItem;
const noPhone = make('c1', 'Lê Thị B', null);
const withPhone = make('c2', 'Nguyễn Văn An', '0912 ••• 678');

describe('CustomerPicker', () => {
  it('thẻ khách đã chọn không SĐT: có tên, không dấu "—" mồ côi, không "null"', () => {
    const { container } = render(
      <CustomerPicker id="x" customers={[]} total={0} onSearch={vi.fn()} selectedCustomer={noPhone as unknown as CustomerDetail} hasError={false} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Lê Thị B')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/—|null|undefined/);
  });

  it('danh sách: khách không SĐT chỉ hiện trạng thái (không "null •"), khách có SĐT hiện "SĐT • trạng thái"', () => {
    render(<CustomerPicker id="x" customers={[noPhone, withPhone]} total={2} onSearch={vi.fn()} selectedCustomer={null} hasError={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chọn khách' }));
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toBe('Lê Thị BMới');
    expect(options[1].textContent).toBe('Nguyễn Văn An0912 ••• 678 • Mới');
  });
});

describe('CustomerFields (select mobile)', () => {
  const form = {
    values: { customerId: '', title: '' },
    errors: {},
    customers: [noPhone, withPhone],
    customerTotal: 2,
    setCustomerSearch: vi.fn(),
    selectedCustomer: null,
    isCustomerLoading: false,
    originCustomer: null,
    changeCustomer: vi.fn(),
    setField: vi.fn(),
  } as unknown as CreateAppointmentForm;

  it('nhãn option: khách không SĐT chỉ có tên; có SĐT là "tên — SĐT"', () => {
    render(<CustomerFields form={form} customerControl="select" />);
    expect(screen.getByRole('option', { name: 'Lê Thị B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nguyễn Văn An — 0912 ••• 678' })).toBeInTheDocument();
  });
});
