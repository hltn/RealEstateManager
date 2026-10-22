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

describe('PhoneDisplay (mọi người xem được khách)', () => {
  it('có quyền xem số: mặc định che, bấm "Hiện số" mới thấy đầy đủ', () => {
    renderWithStore(<PhoneHarness customerId="CUST-001" />, 'hanh');
    expect(screen.queryByText('0912 345 678')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    expect(screen.getByText('0912 345 678')).toBeInTheDocument();
  });

  it('thành viên nhóm: mặc định che, bấm "Hiện số" thấy số đầy đủ và ghi đúng 1 log PHONE_VIEWED (kể cả StrictMode)', () => {
    const store = renderWithStore(<PhoneHarness customerId="CUST-001" />, 'thao');
    const countLogs = () => store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED').length;
    const before = countLogs();
    expect(screen.getByText(/0912 345 •••/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    expect(screen.getByText('0912 345 678')).toBeInTheDocument();
    expect(countLogs()).toBe(before + 1);
    fireEvent.click(screen.getByRole('button', { name: /Ẩn số/ }));
    expect(countLogs()).toBe(before + 1);
  });
});

describe('đổi khách trên cùng component: không giữ số đã hiện của khách cũ', () => {
  const renderSwitchable = (userId: string, render_: (customerId: string) => ReactElement) => {
    const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
    const tree = (customerId: string) => (
      <StrictMode>
        <MemoryRouter>
          <CrmProvider store={store}>{render_(customerId)}</CrmProvider>
        </MemoryRouter>
      </StrictMode>
    );
    const view = render(tree('CUST-001'));
    return { store, switchTo: (customerId: string) => view.rerender(tree(customerId)) };
  };

  it('PhoneDisplay: hiện số khách A, rerender sang khách B -> chỉ còn số che của B (không lộ số A, không lộ số B)', () => {
    const { store, switchTo } = renderSwitchable('admin', (id) => <PhoneHarness customerId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    expect(screen.getByText('0912 345 678')).toBeInTheDocument();
    const logsBefore = store.getState().state.changeLogs.length;
    switchTo('CUST-002');
    expect(screen.queryByText('0912 345 678')).toBeNull();
    expect(screen.queryByText('0988 333 112')).toBeNull();
    expect(screen.getByText('0988 333 •••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hiện số/ })).toHaveAttribute('aria-pressed', 'false');
    expect(store.getState().state.changeLogs).toHaveLength(logsBefore);
    // Hiện số khách B ghi log cho B, không phải A.
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    expect(screen.getByText('0988 333 112')).toBeInTheDocument();
    expect(store.getState().state.changeLogs[0]).toMatchObject({ action: 'PHONE_VIEWED', customerId: 'CUST-002' });
  });

  it('NationalIdField: CCCD khách A không hiện sang khách B', () => {
    const { switchTo } = renderSwitchable('hanh', (id) => <IdHarness customerId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiện/ }));
    expect(screen.getByText('079092001234')).toBeInTheDocument();
    switchTo('CUST-004');
    expect(screen.queryByText('079092001234')).toBeNull();
    expect(screen.getByRole('button', { name: /Hiện/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
