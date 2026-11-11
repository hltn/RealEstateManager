import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderCrm, signOut } from '../../../../../test/renderCrm';
import { withCareTeamMembers, withEmptyCareTeam, type CrmHarness } from '../../../../../test/crmHarness';
import type { CustomerListItem } from '@crm/api';
import type { CrmDataState } from '@crm/store';
import { BulkActionBar } from './BulkActionBar';

afterEach(signOut);

const NAMES: Record<string, string> = { 'CUST-001': 'Nguyễn Văn An', 'CUST-012': 'Ngô Thanh Sơn' };
const getCustomer = (customerId: string) => ({ id: customerId, fullName: NAMES[customerId] ?? customerId, status: { id: 'unknown', label: '' } }) as unknown as CustomerListItem;

const setup = (actAs: string, mutate?: (data: CrmDataState) => CrmDataState) => {
  const handlers = { onClear: vi.fn(), onDeselect: vi.fn(), onDeleteResult: vi.fn() };
  const rendered = renderCrm(<BulkActionBar selectedIds={['CUST-001', 'CUST-012']} getCustomer={getCustomer} {...handlers} />, { actAs, mutate });
  return { ...rendered, ...handlers };
};

const chooseAssign = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Hành động hàng loạt' }), 'ASSIGN');
};

const memberIdsOf = (harness: CrmHarness, customerId: string) =>
  (harness.state().customers.find((customer) => customer.id === customerId)?.careTeam ?? []).filter((member) => member.role === 'MEMBER').map((member) => member.userId);

describe('BulkActionBar: thêm thành viên', () => {
  it.each([['admin'], ['hanh']])('%s thấy "Thêm thành viên", không có lựa chọn đặt/đổi người chăm sóc chính', (userId) => {
    setup(userId);
    const options = within(screen.getByRole('combobox', { name: 'Hành động hàng loạt' }))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(options).toContain('Thêm thành viên');
    expect(options).not.toContain('Thêm người chăm sóc');
    expect(options.filter((text) => /chính|primary/i.test(text))).toEqual([]);
  });

  it('Nhân viên không có hành động thêm thành viên', () => {
    setup('thao');
    expect(screen.queryByRole('option', { name: 'Thêm thành viên' })).not.toBeInTheDocument();
  });

  it('chọn hành động: hiện bộ chọn người (chỉ tên + nhóm), nút Áp dụng khóa đến khi chọn ít nhất một người', async () => {
    const user = userEvent.setup();
    setup('admin');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await chooseAssign(user);
    expect(screen.getByRole('searchbox', { name: 'Tìm người để mời' })).toBeInTheDocument();
    expect(screen.getByText(/Không đặt\/đổi người chăm sóc chính ở đây/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    expect(screen.getByRole('list', { name: 'Danh sách người có thể mời' }).textContent).not.toMatch(/@|\d{4}/);
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
  });

  it('đổi sang hành động khác: bộ chọn người biến mất', async () => {
    const user = userEvent.setup();
    setup('admin');
    await chooseAssign(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hành động hàng loạt' }), 'ADD_TAGS');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('thêm trọn lô: nhiều người cho mọi khách, chỉ thêm MEMBER, bỏ chọn toàn bộ, không mở hộp kết quả', async () => {
    const user = userEvent.setup();
    const { harness, onClear, onDeselect } = setup('admin');
    await chooseAssign(user);
    await user.click(screen.getByRole('checkbox', { name: /^Tuấn ·/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Trang ·/ }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(memberIdsOf(harness, 'CUST-001')).toEqual(expect.arrayContaining(['tuan', 'trang']));
    expect(memberIdsOf(harness, 'CUST-012')).toEqual(expect.arrayContaining(['tuan', 'trang']));
    ['CUST-001', 'CUST-012'].forEach((id) => {
      const primaries = (harness.state().customers.find((customer) => customer.id === id)?.careTeam ?? []).filter((member) => member.role === 'PRIMARY');
      expect(primaries).toHaveLength(1);
    });
    expect(onDeselect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('khách chưa có người chăm sóc chính: báo PRIMARY_REQUIRED riêng từng khách, khách khác vẫn được thêm và bỏ chọn', async () => {
    const user = userEvent.setup();
    const { harness, onClear, onDeselect } = setup('admin', withEmptyCareTeam('CUST-012'));
    await chooseAssign(user);
    await user.click(screen.getByRole('checkbox', { name: /^Tuấn ·/ }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kết quả thêm thành viên' });
    const failed = within(within(dialog).getByRole('region', { name: 'Khách không thêm được' }));
    expect(failed.getByText('Ngô Thanh Sơn')).toBeInTheDocument();
    expect(failed.getByText(/chưa có người chăm sóc chính/)).toBeInTheDocument();
    expect(within(within(dialog).getByRole('region', { name: 'Khách đã thêm được' })).getByText('Nguyễn Văn An')).toBeInTheDocument();
    expect(memberIdsOf(harness, 'CUST-001')).toContain('tuan');
    expect(harness.state().customers.find((customer) => customer.id === 'CUST-012')?.careTeam).toEqual([]);
    expect(onDeselect).toHaveBeenCalledWith(['CUST-001']);
    expect(onClear).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Đã hiểu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('khách đã đủ 10 thành viên phụ: báo CARE_TEAM_LIMIT_EXCEEDED riêng từng khách', async () => {
    const user = userEvent.setup();
    const { harness, onDeselect } = setup('admin', withCareTeamMembers('CUST-012', 10));
    await chooseAssign(user);
    await user.click(screen.getByRole('checkbox', { name: /^Tuấn ·/ }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kết quả thêm thành viên' });
    expect(within(dialog).getByText('Ngô Thanh Sơn')).toBeInTheDocument();
    expect(within(dialog).getByText(/vượt giới hạn 10 thành viên phụ/)).toBeInTheDocument();
    expect(memberIdsOf(harness, 'CUST-012')).not.toContain('tuan');
    expect(memberIdsOf(harness, 'CUST-001')).toContain('tuan');
    expect(onDeselect).toHaveBeenCalledWith(['CUST-001']);
  });
});
