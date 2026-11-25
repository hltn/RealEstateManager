import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import { withoutPhone, type CrmHarness } from '../../../../test/crmHarness';
import DeletedCustomersDesktop from './DeletedCustomers.desktop';
import DeletedCustomersMobile from './DeletedCustomers.mobile';

afterEach(signOut);

const codeOf = (harness: CrmHarness, customerId: string): string => {
  const code = harness.state().customers.find((customer) => customer.id === customerId)?.customerCode;
  if (!code) throw new Error(`Khách mẫu ${customerId} chưa có mã`);
  return code;
};

describe.each([
  ['desktop', DeletedCustomersDesktop],
  ['mobile', DeletedCustomersMobile],
] as const)('Khách đã xóa (%s)', (_name, Component) => {
  it('mỗi dòng hiện mã khách cạnh tên', async () => {
    const { harness } = renderCrm(<Component />, { actAs: 'admin', route: '/crm/customers/deleted' });
    const badge = await screen.findByText(codeOf(harness, 'CUST-D01'));
    expect(badge).toBeInTheDocument();
  });

  it('khách đã xóa không có SĐT: vẫn hiện dòng với mã, không lỗi', async () => {
    const { harness } = renderCrm(<Component />, { actAs: 'admin', route: '/crm/customers/deleted', mutate: withoutPhone('CUST-D01') });
    const badge = await screen.findByText(codeOf(harness, 'CUST-D01'));
    const row = badge.closest('li, tr, article') as HTMLElement;
    expect(within(row).getByText('Hồ Gia Bảo')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/null|undefined/);
  });
});
