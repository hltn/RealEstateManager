import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { CustomerFields } from './AppointmentFormFields';

const CUSTOMER = { id: '6add87b88f689f6e6cd96833', fullName: 'Smoke Test Khách Giả', phoneMasked: '0909 ••• 123', status: { id: 's', label: 'Mới', tone: 'brand' }, projects: [], careTeam: [], primaryAssignee: null };

const makeForm = (isLocked: boolean): CreateAppointmentForm =>
  ({
    values: { customerId: CUSTOMER.id, title: '' },
    errors: {},
    customers: [],
    customerTotal: 0,
    setCustomerSearch: vi.fn(),
    selectedCustomer: CUSTOMER,
    isCustomerLoading: false,
    originCustomer: isLocked ? { id: CUSTOMER.id, name: CUSTOMER.fullName } : null,
    changeCustomer: vi.fn(),
    setField: vi.fn(),
  }) as unknown as CreateAppointmentForm;

describe('trường khách của form tạo lịch hẹn: khóa khi mở từ chi tiết khách', () => {
  it('desktop khóa: hiện tên khách + nhãn "Khách đang xem" + giải thích, KHÔNG có nút đổi khách', () => {
    render(<CustomerFields form={makeForm(true)} customerControl="picker" />);
    expect(screen.getByText('Smoke Test Khách Giả')).toBeInTheDocument();
    expect(screen.getByText('Khách đang xem')).toBeVisible();
    expect(screen.getByText(/không đổi được khách/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thay đổi khách|Chọn khách/ })).toBeNull();
  });

  it('desktop không khóa (mở từ Lịch hẹn hoặc khách gốc không tải được): còn nút "Thay đổi khách"', () => {
    render(<CustomerFields form={makeForm(false)} customerControl="picker" />);
    expect(screen.getByRole('button', { name: 'Thay đổi khách' })).toBeEnabled();
    expect(screen.queryByText('Khách đang xem')).toBeNull();
  });

  it('thẻ khóa gắn nhãn đúng cách: nhóm tên "Khách hàng", mô tả "không đổi được khách", không có <label for> trỏ vào phần tử không gắn được', () => {
    const { container } = render(<CustomerFields form={makeForm(true)} customerControl="picker" />);
    const group = screen.getByRole('group', { name: /Khách hàng/ });
    expect(group).toHaveAccessibleDescription(/không đổi được khách/);
    expect(container.querySelector('label[for="appointment-customerId"]')).toBeNull();
  });

  it('mobile khóa: không còn select khách, hiện cùng thẻ khóa như desktop; không khóa thì vẫn là select dùng được', () => {
    const { rerender } = render(<CustomerFields form={makeForm(true)} customerControl="select" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Smoke Test Khách Giả')).toBeInTheDocument();
    expect(screen.getByText('Khách đang xem')).toBeVisible();
    rerender(<CustomerFields form={makeForm(false)} customerControl="select" />);
    expect(screen.getByRole('combobox')).toBeEnabled();
  });
});
