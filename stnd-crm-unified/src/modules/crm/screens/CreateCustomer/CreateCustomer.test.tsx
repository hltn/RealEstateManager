import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import CreateCustomerDesktop from './CreateCustomer.desktop';
import CreateCustomerMobile from './CreateCustomer.mobile';
import { toCreateCustomerInput, validateCreateCustomer, createDefaultFormValues } from './createCustomerForm';

afterEach(signOut);

/** Chờ lưu xong và màn đã chuyển sang chi tiết khách (đợi hết cập nhật state bất đồng bộ của form). */
const waitForSavedAndOpened = () => waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/crm\/customers\/(?!new)/));

const VARIANTS = [
  { name: 'desktop', Component: CreateCustomerDesktop },
  { name: 'mobile', Component: CreateCustomerMobile },
] as const;

describe.each(VARIANTS)('Form Thêm khách ($name)', ({ Component }) => {
  it('SĐT không còn dấu * bắt buộc, chỉ họ tên bắt buộc', () => {
    renderCrm(<Component />, { route: '/crm/customers/new' });
    const phoneLabel = screen.getByText('Số điện thoại', { selector: 'label' });
    expect(phoneLabel).not.toHaveTextContent('*');
    expect(screen.getByText('Họ và tên khách hàng', { selector: 'label' })).toHaveTextContent('*');
  });

  it('chỉ nhập họ tên vẫn lưu được: phone null, mã khách sinh ra, điều hướng sang chi tiết khách vừa tạo', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Component />, { route: '/crm/customers/new' });
    const before = harness.state().customers.length;
    await user.type(screen.getByLabelText(/Họ và tên khách hàng/), 'Khách Không Số');
    await user.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));

    await waitForSavedAndOpened();
    expect(harness.state().customers).toHaveLength(before + 1);
    const created = harness.state().customers.find((customer) => customer.fullName === 'Khách Không Số');
    expect(created).toBeDefined();
    expect(created?.phone).toBeNull();
    expect(created?.customerCode).toMatch(/^KH-\d{6,}$/);
    // Điều hướng như cũ: mở chi tiết khách vừa tạo.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/crm/customers/${created?.id}`));
  });

  it('không có banner trùng SĐT và lớp ghi không còn tra cứu trùng', () => {
    const { harness } = renderCrm(<Component />, { route: '/crm/customers/new' });
    expect(screen.queryByText(/đã có trong hệ thống|đã tồn tại|SĐT này đã/i)).not.toBeInTheDocument();
    expect(Object.keys(harness.api).filter((key) => /lookup/i.test(key))).toEqual([]);
  });

  it('SĐT có nhập sai định dạng thì báo lỗi và không tạo khách', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Component />, { route: '/crm/customers/new' });
    const before = harness.state().customers.length;
    await user.type(screen.getByLabelText(/Họ và tên khách hàng/), 'Khách Sai Số');
    await user.type(screen.getByLabelText('Số điện thoại'), '123');
    await user.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    expect(await screen.findAllByText(/Số điện thoại không hợp lệ/)).not.toHaveLength(0);
    expect(harness.state().customers).toHaveLength(before);
  });

  it('SĐT trùng khách khác vẫn tạo được (được phép trùng)', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Component />, { route: '/crm/customers/new' });
    const before = harness.state().customers.length;
    await user.type(screen.getByLabelText(/Họ và tên khách hàng/), 'Khách Trùng Số');
    await user.type(screen.getByLabelText('Số điện thoại'), '0912 345 678');
    await user.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    await waitForSavedAndOpened();
    expect(harness.state().customers).toHaveLength(before + 1);
    expect(harness.state().customers.filter((customer) => customer.phone === '+84912345678').length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['thao', 'Nhân viên'],
    ['hanh', 'Quản lý'],
    ['admin', 'Quản trị'],
  ])('%s (%s) thấy dòng chỉ đọc "Người chăm sóc chính: bạn (tự động)", không có bộ chọn người', (userId) => {
    renderCrm(<Component />, { actAs: userId, route: '/crm/customers/new' });
    expect(screen.getByTestId('auto-primary-row')).toHaveTextContent('Người chăm sóc chính: bạn (tự động)');
    expect(screen.queryByRole('combobox', { name: /phụ trách|chăm sóc/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Chọn người phụ trách|Người phụ trách chính/)).not.toBeInTheDocument();
  });

  it.each([
    ['thao', 'STAFF'],
    ['hanh', 'MANAGER'],
    ['admin', 'ADMIN'],
  ])('%s tạo khách: chính người đó là PRIMARY duy nhất của nhóm chăm sóc', async (userId) => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Component />, { actAs: userId, route: '/crm/customers/new' });
    await user.type(screen.getByLabelText(/Họ và tên khách hàng/), `Khách của ${userId}`);
    await user.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    await waitForSavedAndOpened();
    const created = harness.state().customers.find((customer) => customer.fullName === `Khách của ${userId}`);
    expect(created?.careTeam.map((member) => [member.userId, member.role])).toEqual([[userId, 'PRIMARY']]);
    expect(created?.primaryAssigneeId).toBe(userId);
  });
});

describe('toCreateCustomerInput / validateCreateCustomer', () => {
  const base = createDefaultFormValues({ statusId: 'st-not-contacted' });

  it('chỉ họ tên là hợp lệ', () => {
    expect(validateCreateCustomer({ ...base, fullName: 'An' })).toEqual({});
  });

  it('thiếu họ tên bị chặn', () => {
    expect(validateCreateCustomer({ ...base, fullName: '   ' }).fullName).toBeTruthy();
  });

  it('SĐT rỗng hoặc chỉ khoảng trắng -> phone null, payload không có careTeam', () => {
    for (const phone of ['', '   ']) {
      const input = toCreateCustomerInput({ ...base, fullName: ' An ', phone });
      expect(input.phone).toBeNull();
      expect(input.fullName).toBe('An');
      expect(input).not.toHaveProperty('careTeam');
    }
  });

  it('có SĐT thì giữ chuỗi đã trim để lớp ghi chuẩn hóa', () => {
    expect(toCreateCustomerInput({ ...base, fullName: 'An', phone: ' 0912 345 678 ' }).phone).toBe('0912 345 678');
  });
});
