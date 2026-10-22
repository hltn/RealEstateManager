/** Bật cờ gọi/Zalo trong ứng dụng: số đầy đủ lấy qua createPhoneView TRONG handler (1 log / lần mở, StrictMode không nhân đôi), modal nhận số từ đó. */
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { useContactActions } from './useContactActions';

vi.mock('@crm/config/featureFlags', () => ({
  CRM_FEATURE_FLAGS: { isPrototypeEnabled: true, isInAppCallEnabled: true, isZaloZnsEnabled: true, isAppointmentNotifySyncEnabled: false },
}));
vi.mock('./useIsMobile', () => ({ useIsMobile: () => false }));

const setup = (userId: string) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <MemoryRouter>
        <CrmProvider store={store}>{children}</CrmProvider>
      </MemoryRouter>
    </StrictMode>
  );
  const { result } = renderHook(() => useContactActions(), { wrapper });
  const phoneLogs = () => store.getState().state.changeLogs.filter((log) => log.action === 'PHONE_VIEWED');
  return { store, result, phoneLogs };
};

describe('modal Gọi / Zalo trong ứng dụng', () => {
  it('Gọi: mở modal mang số đầy đủ và ghi ĐÚNG 1 log PHONE_VIEWED (không trùng do StrictMode/re-render)', () => {
    const { store, result, phoneLogs } = setup('thao');
    act(() => result.current.callCustomer('CUST-001'));
    expect(store.getState().state.activeModal).toEqual({ kind: 'call', customerId: 'CUST-001', phone: '+84912345678' });
    expect(phoneLogs()).toHaveLength(1);
    expect(phoneLogs()[0]).toMatchObject({ customerId: 'CUST-001', actorId: 'thao' });
  });

  it('Zalo: cũng lấy số qua createPhoneView — 1 log, modal có số', () => {
    const { store, result, phoneLogs } = setup('hanh');
    act(() => result.current.messageZalo('CUST-001'));
    expect(store.getState().state.activeModal).toEqual({ kind: 'zalo', customerId: 'CUST-001', phone: '+84912345678' });
    expect(phoneLogs()).toHaveLength(1);
  });

  it('mỗi lần mở là 1 lần xem: mở lại -> log thứ 2', () => {
    const { result, phoneLogs } = setup('thao');
    act(() => result.current.callCustomer('CUST-001'));
    act(() => result.current.callCustomer('CUST-001'));
    expect(phoneLogs()).toHaveLength(2);
  });

  it('khách ngoài phạm vi: không mở modal, không ghi log', () => {
    const { store, result, phoneLogs } = setup('thao');
    act(() => {
      result.current.callCustomer('CUST-002');
      result.current.messageZalo('CUST-002');
    });
    expect(store.getState().state.activeModal).toBeNull();
    expect(phoneLogs()).toHaveLength(0);
  });
});
