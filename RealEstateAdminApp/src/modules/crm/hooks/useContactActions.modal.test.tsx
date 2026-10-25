/** Bật cờ gọi/Zalo trong ứng dụng: số đầy đủ lấy qua API `phone-views` TRONG handler (1 lượt / lần mở), modal nhận số từ đó. */
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { useContactActions } from './useContactActions';

const createPhoneView = vi.fn();
vi.mock('@crm/api', () => ({ useCrmApi: () => ({ createPhoneView }) }));
vi.mock('@crm/config/featureFlags', () => ({
  CRM_FEATURE_FLAGS: { isPrototypeEnabled: true, isInAppCallEnabled: true, isZaloZnsEnabled: true, isAppointmentNotifySyncEnabled: false },
}));
vi.mock('./useIsMobile', () => ({ useIsMobile: () => false }));

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <MemoryRouter>
        <CrmProvider store={store}>{children}</CrmProvider>
      </MemoryRouter>
    </StrictMode>
  );
  const { result } = renderHook(() => useContactActions(), { wrapper });
  return { store, result };
};

beforeEach(() => createPhoneView.mockReset());

describe('modal Gọi / Zalo trong ứng dụng', () => {
  it('Gọi: lấy số với mục đích CALL, mở modal mang số đầy đủ, đúng 1 lượt xem', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678', viewedAt: 't' } });
    const { store, result } = setup();
    await act(async () => result.current.callCustomer('c1'));
    expect(createPhoneView).toHaveBeenCalledTimes(1);
    expect(createPhoneView).toHaveBeenCalledWith('c1', 'CALL');
    expect(store.getState().state.activeModal).toEqual({ kind: 'call', customerId: 'c1', phone: '+84912345678' });
  });

  it('Zalo: lấy số (VIEW) rồi mở modal Zalo', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678', viewedAt: 't' } });
    const { store, result } = setup();
    await act(async () => result.current.messageZalo('c1'));
    expect(createPhoneView).toHaveBeenCalledWith('c1', 'VIEW');
    expect(store.getState().state.activeModal).toEqual({ kind: 'zalo', customerId: 'c1', phone: '+84912345678' });
  });

  it('mỗi lần mở là một lượt xem: mở lại -> gọi API lần 2', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678', viewedAt: 't' } });
    const { result } = setup();
    await act(async () => result.current.callCustomer('c1'));
    await act(async () => result.current.callCustomer('c1'));
    expect(createPhoneView).toHaveBeenCalledTimes(2);
  });

  it('khách ngoài phạm vi (404) hoặc bị giới hạn (429): không mở modal', async () => {
    createPhoneView.mockResolvedValue({ ok: false, error: { statusCode: 404, errorCode: 'CUSTOMER_NOT_FOUND', message: 'Không tìm thấy khách hàng.' } });
    const { store, result } = setup();
    await act(async () => {
      await result.current.callCustomer('c2');
      await result.current.messageZalo('c2');
    });
    expect(store.getState().state.activeModal).toBeNull();
  });
});
