import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import { withoutPhone, type CrmHarness } from '../../../../test/crmHarness';
import CustomerDetailDesktop from './CustomerDetail.desktop';
import CustomerDetailMobile from './CustomerDetail.mobile';

afterEach(signOut);

const VARIANTS = [
  { name: 'desktop', Component: CustomerDetailDesktop },
  { name: 'mobile', Component: CustomerDetailMobile },
] as const;

const codeOf = (harness: CrmHarness, customerId: string): string => {
  const code = harness.state().customers.find((customer) => customer.id === customerId)?.customerCode;
  if (!code) throw new Error(`Khách mẫu ${customerId} chưa có mã`);
  return code;
};

describe.each(VARIANTS)('Chi tiết khách ($name): mã khách', ({ Component }) => {
  it.each([
    ['admin', 'Quản trị'],
    ['hanh', 'Quản lý'],
    ['thao', 'Nhân viên (thành viên nhóm)'],
  ])('%s (%s) thấy mã khách ở đầu trang', async (userId) => {
    const { harness } = renderCrm(<Component />, { actAs: userId, route: '/crm/customers/CUST-001' });
    const badges = await screen.findAllByText(codeOf(harness, 'CUST-001'));
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});

describe.each(VARIANTS)('Chi tiết khách ($name): khách chưa có SĐT', ({ Component }) => {
  it('hiện mã khách, báo "Chưa có số điện thoại", không có nút Hiện số/Gọi/Zalo và không lỗi', async () => {
    const { harness } = renderCrm(<Component />, { actAs: 'hanh', route: '/crm/customers/CUST-017' });
    expect((await screen.findAllByText(codeOf(harness, 'CUST-017'))).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /Hiện số/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Gọi$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zalo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/null|undefined/)).not.toBeInTheDocument();
  });

  it('khách đang có SĐT rồi bị xóa số: cũng hiện đúng, không có nút liên hệ bằng số', async () => {
    renderCrm(<Component />, { actAs: 'admin', route: '/crm/customers/CUST-001', mutate: withoutPhone('CUST-001') });
    expect(await screen.findAllByText('Nguyễn Văn An')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Hiện số/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Gọi$/ })).not.toBeInTheDocument();
  });

  it('khách có SĐT: vẫn có nút Hiện số', async () => {
    renderCrm(<Component />, { actAs: 'hanh', route: '/crm/customers/CUST-001' });
    expect(await screen.findAllByRole('button', { name: /Hiện số/ })).not.toHaveLength(0);
  });
});

describe('Chi tiết khách (mobile): thanh liên hệ cố định', () => {
  it('khách có SĐT: có nút Gọi và Zalo', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'hanh', route: '/crm/customers/CUST-001' });
    expect((await screen.findAllByRole('button', { name: /Gọi/ })).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /Zalo/ }).length).toBeGreaterThanOrEqual(1);
  });

  it('khách chưa có SĐT: ẩn thanh Gọi/Zalo', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'hanh', route: '/crm/customers/CUST-017' });
    await screen.findByTestId('customer-detail-mobile');
    expect(screen.queryByRole('button', { name: /Gọi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zalo/ })).not.toBeInTheDocument();
  });
});
