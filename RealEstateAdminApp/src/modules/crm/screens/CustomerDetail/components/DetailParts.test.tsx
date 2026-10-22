import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCustomerDetail } from '@crm/api';
import { resetNationalIdVaultForTest, seedNationalIds } from '@crm/lib/nationalIdVault';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { NationalIdField, PhoneDisplay } from './DetailParts';

beforeEach(() => {
  resetNationalIdVaultForTest();
  seedNationalIds({ 'CUST-001': '079092001234' });
});

const renderWithStore = (ui: ReactElement, userId: string) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  render(
    <StrictMode>
      <MemoryRouter>
        <CrmProvider store={store}>{ui}</CrmProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  return store;
};

const IdHarness = ({ customerId }: { customerId: string }) => {
  const { data: customer } = useCustomerDetail(customerId);
  return customer ? <NationalIdField customer={customer} /> : <span>không thấy</span>;
};

describe('C1 NationalIdField trong StrictMode', () => {
  it('1 lần bấm "Hiện" = đúng 1 log xem CCCD (không gọi API trong updater setState)', () => {
    const store = renderWithStore(<IdHarness customerId="CUST-001" />, 'hanh');
    const before = store.getState().state.nationalIdViews.length;
    fireEvent.click(screen.getByRole('button', { name: /Hiện/ }));
    expect(store.getState().state.nationalIdViews).toHaveLength(before + 1);
    expect(screen.getByText('079092001234')).toBeInTheDocument();
  });

  it('bấm "Ẩn" không ghi thêm log', () => {
    const store = renderWithStore(<IdHarness customerId="CUST-001" />, 'hanh');
    fireEvent.click(screen.getByRole('button', { name: /Hiện/ }));
    const afterReveal = store.getState().state.nationalIdViews.length;
    fireEvent.click(screen.getByRole('button', { name: /Ẩn/ }));
    expect(store.getState().state.nationalIdViews).toHaveLength(afterReveal);
    expect(screen.queryByText('079092001234')).toBeNull();
  });

  it('nhân viên không có quyền: không có nút "Hiện"', () => {
    renderWithStore(<IdHarness customerId="CUST-001" />, 'thao');
    expect(screen.queryByRole('button', { name: /Hiện/ })).toBeNull();
  });
});

const PhoneHarness = ({ customerId }: { customerId: string }) => {
  const { data: customer } = useCustomerDetail(customerId);
  return customer ? <PhoneDisplay customer={customer} /> : <span>không thấy</span>;
};

describe('TB1 PhoneDisplay theo quyền', () => {
  it('có quyền xem số: mặc định che, bấm "Hiện số" mới thấy đầy đủ', () => {
    renderWithStore(<PhoneHarness customerId="CUST-001" />, 'hanh');
    expect(screen.queryByText('0912 345 678')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    expect(screen.getByText('0912 345 678')).toBeInTheDocument();
  });

  it('thành viên không có quyền xem số: chỉ thấy số che, không có liên kết tel:', () => {
    renderWithStore(<PhoneHarness customerId="CUST-001" />, 'thao');
    expect(screen.queryByText('0912 345 678')).toBeNull();
    expect(screen.getByText(/0912 345 •••/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hiện số/ })).toBeNull();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });
});
