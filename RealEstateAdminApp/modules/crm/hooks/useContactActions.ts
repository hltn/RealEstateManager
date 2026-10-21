import { useMemo } from 'react';
import { openTelLink } from '@crm/lib/contact';
import { useCrmActions, useCrmState } from '@crm/store';
import { useIsMobile } from './useIsMobile';

export interface ContactActions {
  /** Desktop: mở CallModal (ghi nhật ký cuộc gọi). Mobile: toast + mở `tel:` của thiết bị. */
  callCustomer: (customerId: string) => void;
  /** Desktop: mở ZaloModal (mẫu tin nhắn). Mobile: toast "Mở đoạn chat Zalo". */
  messageZalo: (customerId: string) => void;
  /** Mở Ghi chú nhanh (desktop = modal giữa màn, mobile = bottom sheet). */
  openQuickNote: (customerId: string) => void;
}

/** Hành vi liên hệ khách phụ thuộc thiết bị - màn hình dùng hook này thay vì tự xử lý. */
export const useContactActions = (): ContactActions => {
  const isMobile = useIsMobile();
  const actions = useCrmActions();
  const { customers } = useCrmState();

  return useMemo(() => {
    const findCustomer = (customerId: string) => customers.find((customer) => customer.id === customerId);
    return {
      callCustomer: (customerId) => {
        const customer = findCustomer(customerId);
        if (!customer) return;
        if (!isMobile) {
          actions.openCallModal(customerId);
          return;
        }
        actions.showToast({ title: `Đang gọi đến ${customer.name}`, message: `SĐT: ${customer.phone}`, type: 'info' });
        openTelLink(customer.phone);
      },
      messageZalo: (customerId) => {
        const customer = findCustomer(customerId);
        if (!customer) return;
        if (!isMobile) {
          actions.openZaloModal(customerId);
          return;
        }
        actions.showToast({
          title: 'Mở đoạn chat Zalo',
          message: `Đang kết nối đến Zalo của khách hàng ${customer.name}...`,
        });
      },
      openQuickNote: (customerId) => actions.openQuickNote(customerId),
    };
  }, [actions, customers, isMobile]);
};
