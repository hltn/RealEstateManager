/** useContactActions: khách chưa có SĐT (409 CUSTOMER_PHONE_NOT_SET / số null) -> báo lỗi, không mở modal/tel/Zalo, không lỗi null (FR-02). */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactActions } from './useContactActions';

const createPhoneView = vi.fn();
const openTelLink = vi.fn();
const openZaloChat = vi.fn();
const crmActions = vi.hoisted(() => ({ showToast: vi.fn(), openCallModal: vi.fn(), openZaloModal: vi.fn(), openQuickNote: vi.fn() }));
vi.mock('@crm/api', () => ({ useCrmApi: () => ({ createPhoneView }) }));
vi.mock('@crm/store', () => ({ useCrmActions: () => crmActions }));
vi.mock('@crm/lib/contact', () => ({ openTelLink: (phone: unknown) => openTelLink(phone), openZaloChat: (phone: unknown) => openZaloChat(phone) }));
vi.mock('@crm/config/featureFlags', () => ({
  CRM_FEATURE_FLAGS: { isPrototypeEnabled: true, isInAppCallEnabled: true, isZaloZnsEnabled: true, isAppointmentNotifySyncEnabled: false },
}));
vi.mock('./useIsMobile', () => ({ useIsMobile: () => false }));

beforeEach(() => {
  createPhoneView.mockReset();
  openTelLink.mockReset();
  openZaloChat.mockReset();
  Object.values(crmActions).forEach((fn) => fn.mockReset());
});

const expectNothingOpened = () => {
  expect(crmActions.openCallModal).not.toHaveBeenCalled();
  expect(crmActions.openZaloModal).not.toHaveBeenCalled();
  expect(openTelLink).not.toHaveBeenCalled();
  expect(openZaloChat).not.toHaveBeenCalled();
};

describe('useContactActions với khách không SĐT', () => {
  it('409 CUSTOMER_PHONE_NOT_SET: toast lỗi, không mở modal, không mở tel:/Zalo', async () => {
    createPhoneView.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'CUSTOMER_PHONE_NOT_SET', message: 'Khách chưa có số điện thoại.' } });
    const { result } = renderHook(() => useContactActions());
    await act(async () => {
      await result.current.callCustomer('c1');
      await result.current.messageZalo('c1');
    });
    expectNothingOpened();
    expect(crmActions.showToast).toHaveBeenCalledTimes(2);
    expect(crmActions.showToast).toHaveBeenCalledWith({ type: 'error', title: 'Khách chưa có số điện thoại.' });
  });

  it('server trả phone null dù ok: không mở modal, không gọi tel:/Zalo, không ném lỗi', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: null, viewedAt: 't' } });
    const { result } = renderHook(() => useContactActions());
    await act(async () => {
      await result.current.callCustomer('c1');
      await result.current.messageZalo('c1');
    });
    expectNothingOpened();
  });
});
