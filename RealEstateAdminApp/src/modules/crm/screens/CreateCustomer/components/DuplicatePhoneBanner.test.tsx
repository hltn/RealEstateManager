import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneLookupResult } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { DuplicatePhoneBanner } from './DuplicatePhoneBanner';

const base: PhoneLookupResult = { normalizedPhone: '+84988333112', exists: true, isAccessible: false, caredByName: 'Minh', canRequestJoin: true, hasPendingRequest: false, customerRef: 'JR-x' };

const renderBanner = (lookup: PhoneLookupResult | null, onRequestJoin = vi.fn()): { store: ReturnType<typeof createCrmStore> } & { onRequestJoin: typeof onRequestJoin } => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  const ui: ReactElement = (
    <MemoryRouter>
      <CrmProvider store={store}>
        <DuplicatePhoneBanner lookup={lookup} onRequestJoin={onRequestJoin} variant="desktop" />
      </CrmProvider>
    </MemoryRouter>
  );
  render(ui);
  return { store, onRequestJoin };
};

describe('DuplicatePhoneBanner (X2, C6)', () => {
  it('khách ngoài phạm vi: báo "do [tên] chăm sóc", không lộ tên khách, nút đề nghị phản hồi', () => {
    const { onRequestJoin } = renderBanner(base);
    expect(screen.getByRole('alert')).toHaveTextContent('Đã có khách hàng với số điện thoại này, do Minh chăm sóc.');
    expect(screen.queryByText(/Xem hồ sơ/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Đề nghị tham gia nhóm chăm sóc/ }));
    expect(onRequestJoin).toHaveBeenCalledTimes(1);
  });

  it('khách đã xem được: hiện "Xem hồ sơ" thay vì nút đề nghị', () => {
    const { store } = renderBanner({ ...base, isAccessible: true, customerId: 'CUST-001', customerRef: undefined, canRequestJoin: false });
    expect(screen.queryByRole('button', { name: /Đề nghị tham gia/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Xem hồ sơ/ }));
    expect(store.getState().state.selectedCustomerId).toBe('CUST-001');
  });

  it('đã gửi đề nghị: hiện trạng thái chờ duyệt, không có nút', () => {
    renderBanner({ ...base, hasPendingRequest: true, canRequestJoin: false });
    expect(screen.getByText('Đã gửi đề nghị, đang chờ duyệt')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('chưa trùng: chỉ hiện gợi ý kiểm tra', () => {
    renderBanner({ ...base, exists: false });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Kiểm tra trùng số điện thoại')).toBeInTheDocument();
  });
});
