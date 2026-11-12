import { useMemo } from 'react';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { openTelLink, openZaloChat } from '@crm/lib/contact';
import { useCrmApi } from '@crm/api';
import { useCrmActions } from '@crm/store';
import { useIsMobile } from './useIsMobile';

/** Thông báo khi bấm gọi/Zalo cho khách chưa có SĐT (nút đã ẩn; đây là lớp phòng thủ cho dữ liệu cũ/đua trạng thái). */
export const PHONE_NOT_SET_NOTICE = 'Khách chưa có số điện thoại';

export interface ContactActions {
  /** Gọi khách: mặc định mở `tel:`; chỉ khi bật cờ `isInAppCallEnabled` (desktop) mới mở CallModal. */
  callCustomer: (customerId: string) => Promise<void>;
  /** Zalo: mặc định mở `https://zalo.me/<sđt>` (Z1); chỉ khi bật cờ `isZaloZnsEnabled` (desktop) mới mở ZaloModal. */
  messageZalo: (customerId: string) => Promise<void>;
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
    const requirePhone = async (customerId: string, purpose: 'VIEW' | 'CALL'): Promise<string | null> => {
      const result = await api.createPhoneView(customerId, purpose);
      if (!result.ok) {
        // 409 CUSTOMER_PHONE_NOT_SET (khách chưa có SĐT): thông báo cố định, không phụ thuộc câu chữ của máy chủ.
        actions.showToast({ type: 'error', title: result.error.errorCode === 'CUSTOMER_PHONE_NOT_SET' ? PHONE_NOT_SET_NOTICE : result.error.message });
        return null;
      }
      return result.data.phone;
    };
    return {
      callCustomer: async (customerId) => {
        // Xem số = lấy qua `createPhoneView` (kiểm phạm vi + ghi log) TRONG handler (không trong render/effect -> không trùng log do StrictMode); PHONE_VIEWED server không lưu số.
        const phone = await requirePhone(customerId, 'CALL');
        if (!phone) return;
        if (CRM_FEATURE_FLAGS.isInAppCallEnabled && !isMobile) actions.openCallModal(customerId, phone);
        else openTelLink(phone);
      },
      messageZalo: async (customerId) => {
        const phone = await requirePhone(customerId, 'VIEW');
        if (!phone) return;
        if (CRM_FEATURE_FLAGS.isZaloZnsEnabled && !isMobile) actions.openZaloModal(customerId, phone);
        else openZaloChat(phone);
      },
      openQuickNote: (customerId) => actions.openQuickNote(customerId),
    };
  }, [actions, api, isMobile]);
};
