import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreateAppointmentForm } from '../useCreateAppointmentForm';
import { AssigneeField, CustomerFields } from './AppointmentFormFields';

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

describe('ô người thực hiện của form tạo lịch hẹn (FR-30, T-59)', () => {
  const OPTIONS = [
    { userId: 'p1', fullName: 'An', source: 'PRIMARY' as const, label: 'An (phụ trách chính)' },
    { userId: 'mg', fullName: 'Bình', source: 'OWNER_MANAGER' as const, label: 'Bình (quản lý nhóm)' },
    { userId: 'cr', fullName: 'Chi', source: 'CREATOR' as const, label: 'Chi (người tạo khách)' },
  ];
  const makeAssigneeForm = (assigneeIds: string[], overrides: Partial<CreateAppointmentForm> = {}) =>
    ({ values: { assigneeIds }, errors: {}, assigneeOptions: OPTIONS, setField: vi.fn(), ...overrides }) as unknown as CreateAppointmentForm;

  it('liệt kê cả ba nguồn (nhóm chăm sóc, quản lý nhóm chủ, người tạo khách) và tích thêm một người gọi setField với mảng mới', async () => {
    const form = makeAssigneeForm(['p1']);
    render(<AssigneeField form={form} />);
    await userEvent.click(screen.getByRole('combobox', { name: /Người thực hiện/ }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('An (phụ trách chính)'), expect.stringContaining('Bình (quản lý nhóm)'), expect.stringContaining('Chi (người tạo khách)')]));
    await userEvent.click(screen.getByRole('option', { name: /Chi \(người tạo khách\)/ }));
    expect(form.setField).toHaveBeenCalledWith('assigneeIds', ['p1', 'cr']);
  });

  it('bấm lại người đã chọn thì bỏ chọn người đó', async () => {
    const form = makeAssigneeForm(['p1', 'mg']);
    render(<AssigneeField form={form} />);
    await userEvent.click(screen.getByRole('combobox', { name: /Người thực hiện/ }));
    await userEvent.click(screen.getByRole('option', { name: /An \(phụ trách chính\)/ }));
    expect(form.setField).toHaveBeenCalledWith('assigneeIds', ['mg']);
  });

  it('chưa có danh sách (chưa chọn khách): ô bị khóa và gợi ý chọn khách trước', () => {
    render(<AssigneeField form={makeAssigneeForm([], { assigneeOptions: [] })} />);
    expect(screen.getByRole('combobox', { name: /Người thực hiện/ })).toBeDisabled();
    expect(screen.getByText('Chưa có người nào chọn được cho khách này.')).toBeInTheDocument();
  });

  it('lỗi hiện đúng nguyên văn thông điệp (vd câu của backend) và thay dòng gợi ý', () => {
    render(<AssigneeField form={makeAssigneeForm(['p1'], { errors: { assigneeIds: 'Người được chọn không còn hoạt động.' } })} />);
    expect(screen.getByText('Người được chọn không còn hoạt động.')).toBeInTheDocument();
    expect(screen.queryByText(/Chọn 1 đến 20 người/)).toBeNull();
  });
});
