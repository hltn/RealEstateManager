/**
 * Chi tiết khách prototype: (A) mã khách là chip sao chép NGAY DƯỚI tên trên mobile, chỉ hiện 1 lần; desktop giữ chip header + sao chép;
 * (B) "Xóa khách" trên mobile nằm cuối tab Thông tin (không ở cụm nút đầu trang), desktop giữ nguyên ở cụm nút đầu trang.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import type { CrmHarness } from '../../../../test/crmHarness';
import type { CrmDataState } from '../../store';

const mocks = vi.hoisted(() => ({ copyTextToClipboard: vi.fn() }));
vi.mock('@crm/lib/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import CustomerDetailDesktop from './CustomerDetail.desktop';
import CustomerDetailMobile from './CustomerDetail.mobile';

const ROUTE = '/crm/customers/CUST-001';

beforeEach(() => mocks.copyTextToClipboard.mockReset().mockResolvedValue(true));
afterEach(signOut);

const codeOf = (harness: CrmHarness): string => {
  const code = harness.state().customers.find((customer) => customer.id === 'CUST-001')?.customerCode;
  if (!code) throw new Error('Khách mẫu CUST-001 chưa có mã');
  return code;
};
const copyButtonName = (code: string) => ({ name: `Sao chép mã khách ${code}` });
const deleteButtons = () => screen.queryAllByRole('button', { name: 'Xóa khách' });
/** Khách do Quản trị tạo -> Quản lý `hanh` (không phải người tạo) KHÔNG có quyền xóa. */
const createdByAdmin = (data: CrmDataState): CrmDataState => ({
  ...data,
  customers: data.customers.map((customer) => (customer.id === 'CUST-001' ? { ...customer, createdBy: 'admin' } : customer)),
});

describe('Chi tiết khách (mobile): mã khách dưới tên', () => {
  it('mã là nút chip sao chép NGAY DƯỚI tên (h2 của thẻ tóm tắt), hiện đúng 1 lần, chép đúng mã', async () => {
    const { harness } = renderCrm(<CustomerDetailMobile />, { actAs: 'admin', route: ROUTE });
    const code = codeOf(harness);
    const button = await screen.findByRole('button', copyButtonName(code));
    const summary = screen.getByRole('region', { name: 'Tóm tắt hồ sơ' });
    const heading = within(summary).getByRole('heading', { level: 2 });
    expect(heading.parentElement).toContainElement(button);
    expect(heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(code)).toHaveLength(1);
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith(code));
  });

  it('hàng đầu màn chỉ còn nhãn "Quản lý khách hàng" (không còn mã ở góc)', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'admin', route: ROUTE });
    const label = await screen.findByText('Quản lý khách hàng');
    expect(label.textContent).toBe('Quản lý khách hàng');
  });
});

describe('Chi tiết khách (desktop): mã khách ở header là chip sao chép', () => {
  it('có nút sao chép giữ kiểu chip xám vốn có của header, chép đúng mã, hiện 1 lần', async () => {
    const { harness } = renderCrm(<CustomerDetailDesktop />, { actAs: 'admin', route: ROUTE });
    const code = codeOf(harness);
    const button = await screen.findByRole('button', copyButtonName(code));
    expect(button).toHaveClass('bg-gray-100', 'rounded-md');
    expect(button).not.toHaveClass('min-h-8', 'border', 'bg-gray-50');
    expect(screen.getAllByText(code)).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith(code));
  });
});

describe('Chi tiết khách: nút "Xóa khách"', () => {
  it('mobile có quyền xóa: đúng 1 nút, ở cuối tab Thông tin (có đường kẻ trên), KHÔNG trong thẻ tóm tắt đầu trang', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'admin', route: ROUTE });
    await screen.findByRole('region', { name: 'Tóm tắt hồ sơ' });
    const buttons = deleteButtons();
    expect(buttons).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Tóm tắt hồ sơ' })).queryByRole('button', { name: 'Xóa khách' })).toBeNull();
    expect(buttons[0].parentElement).toHaveClass('border-t');
    expect(buttons[0].className).not.toMatch(/(^|\s)bg-error-(500|600)/);
    const tablist = screen.getByRole('tablist');
    expect(tablist.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('mobile: chỉ ở tab Thông tin, đổi sang Nhật ký/Tiến độ thì không còn', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'admin', route: ROUTE });
    await screen.findByRole('tablist');
    fireEvent.click(screen.getByRole('tab', { name: 'Nhật ký' }));
    expect(deleteButtons()).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Tiến độ' }));
    expect(deleteButtons()).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin' }));
    expect(deleteButtons()).toHaveLength(1);
  });

  it('mobile KHÔNG có quyền xóa (Quản lý không phải người tạo): không có nút ở bất kỳ tab nào', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'hanh', route: ROUTE, mutate: createdByAdmin });
    await screen.findByRole('tablist');
    for (const tab of ['Thông tin', 'Nhật ký', 'Tiến độ']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(deleteButtons()).toHaveLength(0);
    }
  });

  it('mobile: bấm nút mở hộp xác nhận có ô lý do', async () => {
    renderCrm(<CustomerDetailMobile />, { actAs: 'admin', route: ROUTE });
    await screen.findByRole('tablist');
    fireEvent.click(deleteButtons()[0]);
    expect(screen.getByLabelText(/Lý do xóa/)).toBeInTheDocument();
  });

  it('desktop có quyền xóa: vẫn là nút icon ở cụm nút đầu trang (không đổi)', async () => {
    renderCrm(<CustomerDetailDesktop />, { actAs: 'admin', route: ROUTE });
    const button = await screen.findByRole('button', { name: 'Xóa khách' });
    expect(button).toHaveAttribute('title', 'Xóa khách');
    expect(within(screen.getByRole('region', { name: 'Hồ sơ khách hàng' })).getByRole('button', { name: 'Xóa khách' })).toBe(button);
  });

  it('desktop không quyền xóa: không có nút', async () => {
    renderCrm(<CustomerDetailDesktop />, { actAs: 'hanh', route: ROUTE, mutate: createdByAdmin });
    await screen.findByRole('region', { name: 'Hồ sơ khách hàng' });
    expect(deleteButtons()).toHaveLength(0);
  });
});
