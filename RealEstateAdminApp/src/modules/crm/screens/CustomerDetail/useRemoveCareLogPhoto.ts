/**
 * Gỡ 1 ảnh khỏi nhật ký chăm sóc ĐÃ LƯU (`DELETE care-log-attachments/:id`). Sau khi gỡ, lớp ghi làm mới nhật ký + lịch sử
 * nên ảnh biến mất khỏi dòng thời gian. Lỗi (hết quyền sau 24 giờ, mất kết nối...) báo bằng toast tiếng Việt.
 */
import { useCallback, useState } from 'react';
import { describeWriteError, useCrmApi } from '@crm/api';
import { useCrmActions } from '@crm/store';

export const useRemoveCareLogPhoto = (customerId: string) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [isRemoving, setIsRemoving] = useState(false);

  /** Trả `true` nếu đã gỡ. */
  const removePhoto = useCallback(
    async (attachmentId: string): Promise<boolean> => {
      setIsRemoving(true);
      const result = await api.removeSavedCareLogAttachment(customerId, attachmentId);
      setIsRemoving(false);
      if (!result.ok) {
        showToast({ type: 'error', title: describeWriteError(result.error) });
        return false;
      }
      showToast({ title: 'Đã gỡ ảnh khỏi nhật ký' });
      return true;
    },
    [api, customerId, showToast],
  );

  return { removePhoto, isRemoving };
};
