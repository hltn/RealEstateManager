import { useMemo } from 'react';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { openTelLink, openZaloChat } from '@crm/lib/contact';
import { useCrmApi } from '@crm/api';
import { useCrmActions } from '@crm/store';
import { useIsMobile } from './useIsMobile';

export interface ContactActions {
  /** Gọi khách: mặc định mở `tel:`; chỉ khi bật cờ `isInAppCallEnabled` (desktop) mới mở CallModal. */
  callCustomer: (customerId: string) => void;
  /** Zalo: mặc định mở `https://zalo.me/<sđt>` (Z1); chỉ khi bật cờ `isZaloZnsEnabled` (desktop) mới mở ZaloModal. */
  messageZalo: (customerId: string) => void;
  /** Mở Ghi chú nhanh (desktop = modal giữa màn, mobile = bottom sheet). */
  openQuickNote: (customerId: string) => void;
}

/** Hành vi liên hệ khách phụ thuộc thiết bị + cờ tính năng - màn hình dùng hook này thay vì tự xử lý. */
export const useContactActions = (): ContactActions => {
  const isMobile = useIsMobile();
  const actions = useCrmActions();
  const api = useCrmApi();

  return useMemo(() => {
    /** Số đầy đủ qua lớp dữ liệu (kiểm quyền + ghi log); không có quyền -> toast và null. */
    const requirePhone = (customerId: string): string | null => {
      const result = api.createPhoneView(customerId);
      if (!result.ok) {
        actions.showToast({ type: 'error', title: result.error.message });
        return null;
      }
      return result.data.phone;
    };
    return {
      callCustomer: (customerId) => {
        // Xem số = lấy qua `createPhoneView` (kiểm phạm vi + ghi log) TRONG handler (không trong render/effect -> không trùng log do StrictMode).
        const phone = requirePhone(customerId);
        if (!phone) return;
        if (CRM_FEATURE_FLAGS.isInAppCallEnabled && !isMobile) actions.openCallModal(customerId, phone);
        else openTelLink(phone);
      },
      messageZalo: (customerId) => {
        const phone = requirePhone(customerId);
        if (!phone) return;
        if (CRM_FEATURE_FLAGS.isZaloZnsEnabled && !isMobile) actions.openZaloModal(customerId, phone);
        else openZaloChat(phone);
      },
      openQuickNote: (customerId) => actions.openQuickNote(customerId),
    };
  }, [actions, api, isMobile]);
};
