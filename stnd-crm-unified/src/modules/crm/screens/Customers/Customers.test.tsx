import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import { composeMutations, withLockedUser, type CrmHarness } from '../../../../test/crmHarness';
import { AdvancedFilterModal } from '../../components/AdvancedFilterModal';
import { DEFAULT_FILTERS } from '../../store/crmReducer';
import { CustomersDesktop } from './Customers.desktop';
import { CustomersMobile } from './Customers.mobile';

afterEach(signOut);

const codeOf = (harness: CrmHarness, customerId: string): string => {
  const code = harness.state().customers.find((customer) => customer.id === customerId)?.customerCode;
  if (!code) throw new Error(`Khách mẫu ${customerId} chưa có mã`);
  return code;
};

const displayNameOf = (harness: CrmHarness, userId: string): string => {
  const user = harness.state().users.find((item) => item.id === userId);
  if (!user) throw new Error(`Không có người dùng mẫu ${userId}`);
  return user.displayName;
};

const containerOf = (name: string, selector: 'tr' | 'article'): HTMLElement => {
  const container = screen.getByText(name).closest(selector);
  if (!container) throw new Error(`Không thấy ${selector} của ${name}`);
  return container as HTMLElement;
};
const rowOf = (name: string) => containerOf(name, 'tr');
const cardOf = (name: string) => containerOf(name, 'article');

describe('Danh sách khách (desktop): mã khách', () => {
  it('mã KH nằm ngay cạnh SĐT trong cùng ô khách', () => {
    const { harness } = renderCrm(<CustomersDesktop />, { actAs: 'thao' });
    const badge = within(rowOf('Nguyễn Văn An')).getByText(codeOf(harness, 'CUST-001'));
    expect(badge.parentElement).toHaveTextContent('•••');
  });

  it('khách chưa có SĐT: chỉ hiện mã (không SĐT, không "Chưa có SĐT"), không có nút Gọi/Zalo', () => {
    const { harness } = renderCrm(<CustomersDesktop />, { actAs: 'hanh' });
    const row = rowOf('Mai Thị Hồng');
    const code = codeOf(harness, 'CUST-017');
    const badge = within(row).getByText(code);
    expect(badge.parentElement?.textContent).toBe(`Mã khách ${code}`);
    expect(within(row).queryByText('Chưa có SĐT')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Gọi$/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Zalo$/ })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Ghi chú nhanh/ })).toBeInTheDocument();
  });

  it('khách có SĐT vẫn có nút Gọi và Zalo', () => {
    renderCrm(<CustomersDesktop />, { actAs: 'hanh' });
    const row = rowOf('Nguyễn Văn An');
    expect(within(row).getByRole('button', { name: /Gọi/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Zalo/ })).toBeInTheDocument();
  });

  it('ô tìm có placeholder "Tìm tên, SĐT, mã KH-…"', () => {
    renderCrm(<CustomersDesktop />);
    expect(screen.getByPlaceholderText('Tìm tên, SĐT, mã KH-…')).toBeInTheDocument();
  });
});

describe('Danh sách khách (desktop): cột Người chăm sóc chính', () => {
  it.each([['admin'], ['hanh']])('%s (Quản trị/Quản lý) thấy cột "Người chăm sóc chính"', (userId) => {
    renderCrm(<CustomersDesktop />, { actAs: userId });
    expect(screen.getByRole('columnheader', { name: 'Người chăm sóc chính' })).toBeInTheDocument();
    expect(within(rowOf('Nguyễn Văn An')).getByLabelText('Người chăm sóc chính')).toBeInTheDocument();
    expect(rowOf('Nguyễn Văn An').querySelectorAll('td')).toHaveLength(screen.getAllByRole('columnheader').length);
  });

  it('Nhân viên không có cột Người chăm sóc chính (tiêu đề lẫn ô), số ô vẫn khớp số cột', () => {
    renderCrm(<CustomersDesktop />, { actAs: 'thao' });
    expect(screen.queryByRole('columnheader', { name: /chăm sóc chính/i })).not.toBeInTheDocument();
    expect(within(rowOf('Nguyễn Văn An')).queryByLabelText('Người chăm sóc chính')).not.toBeInTheDocument();
    expect(rowOf('Nguyễn Văn An').querySelectorAll('td')).toHaveLength(screen.getAllByRole('columnheader').length);
  });

  it('người chăm sóc chính bị khóa tài khoản: Quản trị thấy nhãn "(đã khóa)"', () => {
    const { harness } = renderCrm(<CustomersDesktop />, { actAs: 'admin', mutate: composeMutations(withLockedUser('thao')) });
    const row = rowOf('Ngô Thanh Sơn');
    expect(within(row).getByText(new RegExp(displayNameOf(harness, 'thao')))).toBeInTheDocument();
    expect(within(row).getByText('(đã khóa)')).toBeInTheDocument();
  });

  it('người chăm sóc chính còn hoạt động: không có nhãn "đã khóa"', () => {
    renderCrm(<CustomersDesktop />, { actAs: 'admin' });
    expect(within(rowOf('Ngô Thanh Sơn')).queryByText('(đã khóa)')).not.toBeInTheDocument();
  });
});

describe('Danh sách khách (mobile)', () => {
  it('thẻ hiện mã cạnh SĐT; khách chưa có SĐT chỉ hiện mã và không có nút Gọi/Zalo', () => {
    const { harness } = renderCrm(<CustomersMobile />, { actAs: 'hanh' });
    const withPhone = cardOf('Nguyễn Văn An');
    expect(within(withPhone).getByText(codeOf(harness, 'CUST-001')).parentElement).toHaveTextContent('•••');
    expect(within(withPhone).getByRole('button', { name: /Gọi/ })).toBeInTheDocument();

    const noPhone = cardOf('Mai Thị Hồng');
    const code = codeOf(harness, 'CUST-017');
    expect(within(noPhone).getByText(code).parentElement?.textContent).toBe(`Mã khách ${code}`);
    expect(within(noPhone).queryByRole('button', { name: /Gọi/ })).not.toBeInTheDocument();
    expect(within(noPhone).queryByRole('button', { name: /Zalo/ })).not.toBeInTheDocument();
    expect(within(noPhone).getByRole('button', { name: /Ghi chú/ })).toBeInTheDocument();
  });

  it.each([['admin'], ['hanh']])('%s thấy dòng "Chăm sóc: <tên>" trên thẻ', (userId) => {
    const { harness } = renderCrm(<CustomersMobile />, { actAs: userId });
    const card = cardOf('Nguyễn Văn An');
    expect(within(card).getByText('Chăm sóc:')).toBeInTheDocument();
    expect(within(card).getByText(displayNameOf(harness, 'hanh'))).toBeInTheDocument();
  });

  it('Nhân viên không thấy dòng "Chăm sóc"', () => {
    renderCrm(<CustomersMobile />, { actAs: 'thao' });
    expect(within(cardOf('Nguyễn Văn An')).queryByText('Chăm sóc:')).not.toBeInTheDocument();
  });

  it('người chăm sóc chính bị khóa: thẻ hiện "(đã khóa)" cho Quản trị', () => {
    renderCrm(<CustomersMobile />, { actAs: 'admin', mutate: composeMutations(withLockedUser('hanh')) });
    expect(within(cardOf('Nguyễn Văn An')).getByText('(đã khóa)')).toBeInTheDocument();
  });

  it('ô tìm có placeholder "Tìm tên, SĐT, mã KH-…"', () => {
    renderCrm(<CustomersMobile />);
    expect(screen.getByPlaceholderText('Tìm tên, SĐT, mã KH-…')).toBeInTheDocument();
  });
});

describe('Bộ lọc nâng cao: "Phụ trách chính"', () => {
  const renderModal = (actAs: string, variant: 'sheet' | 'dialog') =>
    renderCrm(<AdvancedFilterModal filters={DEFAULT_FILTERS} variant={variant} onApply={() => undefined} onReset={() => undefined} onClose={() => undefined} />, { actAs });

  it.each([
    ['admin', 'sheet'],
    ['hanh', 'dialog'],
  ] as const)('%s thấy nhóm lọc "Phụ trách chính" (%s)', (userId, variant) => {
    renderModal(userId, variant);
    expect(screen.getByRole('group', { name: 'Phụ trách chính' })).toBeInTheDocument();
  });

  it.each([['sheet'], ['dialog']] as const)('Nhân viên không thấy nhóm "Phụ trách chính" nhưng vẫn có nhóm người chăm sóc (%s)', (variant) => {
    renderModal('thao', variant);
    expect(screen.queryByRole('group', { name: 'Phụ trách chính' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Người chăm sóc \(chính hoặc hỗ trợ\)/ })).toBeInTheDocument();
  });
});
