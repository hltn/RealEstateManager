/**
 * Thao tác ghi dữ liệu của màn "Chi tiết khách hàng" (dùng chung desktop + mobile).
 * Gói các action của store để component con tự gọi, không phải truyền callback xuống nhiều cấp.
 */
import { useMemo } from 'react';
import { useCrmActions } from '@crm/store';
import type { C4Criteria, C4CriterionKey, CustomerStatus, GalleryImage } from '@crm/types/crm';
import { toggleC4Criterion } from './customerDetailUtils';

export interface SaveCareLogInput {
  content: string;
  callResult?: string;
  images?: GalleryImage[];
  tag?: string;
  toastTitle: string;
}

export interface CustomerDetailActions {
  /** Đổi trạng thái (cập nhật ngay trên giao diện) + toast xác nhận. */
  changeStatus: (status: CustomerStatus) => void;
  toggleCriterion: (c4: C4Criteria, key: C4CriterionKey) => void;
  /** Lưu nhật ký; trả `false` nếu nội dung trống (không lưu). */
  saveCareLog: (input: SaveCareLogInput) => boolean;
  /** Toast thông tin cho các nút prototype chưa có chức năng thật (thay `alert`). */
  notify: (title: string) => void;
}

export const useCustomerDetailActions = (customerId: string): CustomerDetailActions => {
  const { updateCustomer, addCareLog, showToast } = useCrmActions();

  return useMemo(
    () => ({
      changeStatus: (status) => updateCustomer(customerId, { status }, { toastTitle: `Đã chuyển trạng thái: ${status}` }),
      toggleCriterion: (c4, key) => updateCustomer(customerId, toggleC4Criterion(c4, key)),
      saveCareLog: ({ content, callResult, images, tag, toastTitle }) => {
        const trimmedContent = content.trim();
        if (!trimmedContent) return false;
        addCareLog(
          {
            customerId,
            content: trimmedContent,
            ...(callResult ? { callResult } : {}),
            ...(tag ? { tag } : {}),
            ...(images && images.length > 0 ? { images } : {}),
          },
          { toastTitle },
        );
        return true;
      },
      notify: (title) => {
        showToast({ title, type: 'info' });
      },
    }),
    [addCareLog, customerId, showToast, updateCustomer],
  );
};
