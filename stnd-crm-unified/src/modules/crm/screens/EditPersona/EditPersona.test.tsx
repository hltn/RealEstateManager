import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import EditPersonaDesktop from './EditPersona.desktop';
import EditPersonaMobile from './EditPersona.mobile';
import { getChangedBasicInput, type BasicInfoValues } from './personaForm';

afterEach(signOut);

const baseBasic: BasicInfoValues = {
  fullName: 'An',
  phone: '',
  email: '',
  nationalId: '',
  areaId: '',
  sourceId: '',
  interestedProjectIds: [],
  tagIds: [],
};

describe('getChangedBasicInput (SĐT)', () => {
  it('khách có số, đã mở khóa, xóa trắng ô -> gửi phone null (xóa số)', () => {
    expect(getChangedBasicInput(baseBasic, { ...baseBasic, phone: '  ' }, false, '+84912345678')).toEqual({ phone: null });
  });

  it('khách chưa có số, ô vẫn rỗng -> không có thay đổi', () => {
    expect(getChangedBasicInput(baseBasic, baseBasic, false, null)).toBeUndefined();
  });

  it('khách chưa có số, nhập số mới -> gửi chuỗi đã nhập', () => {
    expect(getChangedBasicInput(baseBasic, { ...baseBasic, phone: '0912 345 678' }, false, null)).toEqual({ phone: '0912 345 678' });
  });

  it('còn khóa (chưa bấm "Sửa số") -> không gửi SĐT dù ô rỗng', () => {
    expect(getChangedBasicInput(baseBasic, baseBasic, true, null)).toBeUndefined();
  });
});

describe.each([
  { name: 'desktop', Component: EditPersonaDesktop },
  { name: 'mobile', Component: EditPersonaMobile },
])('Sửa chân dung khách ($name)', ({ Component }) => {
  it('khách có SĐT: "Sửa số" mở khóa, xóa trắng ô rồi lưu -> phone = null trong dữ liệu', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Component />, { route: '/crm/customers/CUST-001/persona' });
    await user.click(screen.getByRole('button', { name: 'Sửa số' }));
    // Ô SĐT được dựng lại sau khi lấy số đầy đủ: lấy lại phần tử sau khi mở khóa.
    await waitFor(() => expect(screen.getByLabelText('Số điện thoại')).toHaveValue('0912 345 678'));
    await user.clear(screen.getByLabelText('Số điện thoại'));
    await user.click(screen.getByRole('button', { name: /Lưu chân dung/ }));
    await waitFor(() => expect(harness.state().customers.find((customer) => customer.id === 'CUST-001')?.phone).toBeNull());
    await waitFor(() => expect(screen.queryByText('Đang lưu…')).not.toBeInTheDocument());
  });

  it('khách chưa có SĐT: ô SĐT mở sẵn (không có nút "Sửa số") và nhập số mới lưu được', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Component />, { route: '/crm/customers/CUST-017/persona' });
    expect(screen.queryByRole('button', { name: 'Sửa số' })).not.toBeInTheDocument();
    const phoneInput = screen.getByLabelText('Số điện thoại');
    expect(phoneInput).not.toHaveAttribute('readonly');
    await user.type(phoneInput, '0912 345 678');
    await user.click(screen.getByRole('button', { name: /Lưu chân dung/ }));
    await waitFor(() => expect(harness.state().customers.find((customer) => customer.id === 'CUST-017')?.phone).toBe('+84912345678'));
    await waitFor(() => expect(screen.queryByText('Đang lưu…')).not.toBeInTheDocument());
  });

  it('nhãn SĐT không có dấu * (chỉ họ tên bắt buộc)', () => {
    renderCrm(<Component />, { route: '/crm/customers/CUST-017/persona' });
    expect(screen.getByText('Số điện thoại', { selector: 'label' })).not.toHaveTextContent('*');
    expect(screen.queryByText(/Chỉ họ tên và SĐT là bắt buộc/)).not.toBeInTheDocument();
  });
});
