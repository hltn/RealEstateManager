import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderCrm, signOut } from '../../../test/renderCrm';
import { withoutPhone } from '../../../test/crmHarness';
import { PHONE_NOT_SET_NOTICE, useContactActions } from '../hooks/useContactActions';
import { CallModal, type ContactTarget as CallTarget } from './CallModal';
import { ContactActionGrid } from './ContactActionGrid';
import { TableContactActions } from './TableContactActions';
import { ZaloModal, type ContactTarget as ZaloTarget } from './ZaloModal';

afterEach(() => {
  signOut();
  vi.restoreAllMocks();
});

describe('ContactActionGrid', () => {
  it('có SĐT: có Gọi, Zalo, Ghi chú, Xem', () => {
    renderCrm(<ContactActionGrid customerId="CUST-001" hasPhone />);
    ['Gọi', 'Zalo', 'Ghi chú', 'Xem'].forEach((name) => expect(screen.getByRole('button', { name })).toBeInTheDocument());
  });

  it('chưa có SĐT: ẩn Gọi và Zalo, vẫn còn Ghi chú và Xem', () => {
    renderCrm(<ContactActionGrid customerId="CUST-017" hasPhone={false} />);
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem' })).toBeInTheDocument();
  });
});

describe('TableContactActions', () => {
  it('có SĐT: có Gọi, Zalo và Ghi chú nhanh', () => {
    renderCrm(<TableContactActions customerId="CUST-001" customerName="Nguyễn Văn An" hasPhone />);
    expect(screen.getByRole('button', { name: 'Gọi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zalo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú nhanh cho Nguyễn Văn An' })).toBeInTheDocument();
  });

  it('chưa có SĐT: chỉ còn Ghi chú nhanh', () => {
    renderCrm(<TableContactActions customerId="CUST-017" customerName="Mai Thị Hồng" hasPhone={false} />);
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú nhanh cho Mai Thị Hồng' })).toBeInTheDocument();
  });
});

describe('useContactActions: khách chưa có SĐT (409 CUSTOMER_PHONE_NOT_SET)', () => {
  const Probe = ({ customerId }: { customerId: string }) => {
    const { callCustomer, messageZalo } = useContactActions();
    return (
      <>
        <button type="button" onClick={() => void callCustomer(customerId)}>
          probe-call
        </button>
        <button type="button" onClick={() => void messageZalo(customerId)}>
          probe-zalo
        </button>
      </>
    );
  };

  it.each([['probe-call'], ['probe-zalo']])('%s: toast "Khách chưa có số điện thoại", không mở liên kết gọi/Zalo', async (buttonName) => {
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue('t');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderCrm(<Probe customerId="CUST-001" />, { mutate: withoutPhone('CUST-001') });
    await user.click(screen.getByRole('button', { name: buttonName }));
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    expect(errorToast.mock.calls[0][0]).toBe(PHONE_NOT_SET_NOTICE);
    expect(PHONE_NOT_SET_NOTICE).toBe('Khách chưa có số điện thoại');
    expect(openSpy).not.toHaveBeenCalled();
  });
});

const target = (phone: string | null): CallTarget & ZaloTarget => ({ name: 'Mai Thị Hồng', phone, preferredSalutation: 'chị', interestedProjects: [] });

describe('CallModal / ZaloModal với khách chưa có SĐT', () => {
  it('CallModal không lỗi và không vẽ dòng số khi phone null', () => {
    renderCrm(<CallModal customer={target(null)} onClose={() => undefined} onSaveLog={() => undefined} />);
    expect(screen.getByText('Mai Thị Hồng')).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it('CallModal có SĐT: hiện số', () => {
    renderCrm(<CallModal customer={target('0912 345 678')} onClose={() => undefined} onSaveLog={() => undefined} />);
    expect(screen.getByText('0912 345 678')).toBeInTheDocument();
  });

  it('ZaloModal phone null: dòng "Gửi tới" chỉ có tên, không có ngoặc số', () => {
    renderCrm(<ZaloModal customer={target(null)} onClose={() => undefined} onSent={() => undefined} />);
    const line = screen.getByText(/Gửi tới/);
    expect(line.textContent).toBe('Gửi tới: Mai Thị Hồng');
  });

  it('ZaloModal có SĐT: hiện số trong ngoặc', () => {
    renderCrm(<ZaloModal customer={target('0912 345 678')} onClose={() => undefined} onSent={() => undefined} />);
    expect(screen.getByText(/Gửi tới/).textContent).toContain('(0912 345 678)');
  });
});
