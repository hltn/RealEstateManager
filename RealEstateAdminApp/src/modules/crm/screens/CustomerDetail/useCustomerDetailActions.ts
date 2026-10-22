/**
 * Thao tác ghi của màn "Chi tiết khách hàng" (dùng chung desktop + mobile).
 * Gọi lớp dữ liệu `useCrmApi()` (hàm theo endpoint 05) + toast kết quả; component con tự gọi, không truyền callback nhiều cấp.
 */
import { useMemo } from 'react';
import { useCrmApi, type ApiResult, type CreateCareLogInput, type CustomerDetail } from '@crm/api';
import { useCrmActions } from '@crm/store';
import type { CriterionKey } from '@crm/types/crm';

export interface CustomerDetailActions {
  /** Đổi tình trạng (gửi `version`); `shouldOfferUndo` = hiện nút "Hoàn tác" trong toast (02 §5). */
  changeStatus: (statusId: string, options?: { shouldOfferUndo?: boolean }) => void;
  /** Đảo dấu hoàn thành 1 tiêu chí (tiến độ do lớp dữ liệu tính lại). */
  toggleCriterion: (key: CriterionKey) => void;
  /** Lưu mô tả 1 tiêu chí; trả `true` nếu đã lưu. */
  saveCriterionDescription: (key: CriterionKey, description: string) => boolean;
  /** Lưu nhật ký; trả `true` nếu đã lưu. */
  saveCareLog: (input: CreateCareLogInput) => boolean;
  /** Xem CCCD đầy đủ (kiểm quyền + ghi log ở lớp dữ liệu); null nếu không được phép/không có. */
  revealNationalId: () => string | null;
  setOccasionReminder: (isOn: boolean) => void;
}

const UNDO_DURATION_MS = 10_000;

export const useCustomerDetailActions = (customer: Pick<CustomerDetail, 'id' | 'version' | 'status' | 'criteria'>): CustomerDetailActions => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const { id: customerId, version, status, criteria } = customer;

  return useMemo(() => {
    /** Báo lỗi API bằng toast tiếng Việt dễ hiểu (02 §8: không hiện mã lỗi). */
    const handle = <T,>(result: ApiResult<T>, successTitle?: string): result is { ok: true; data: T } => {
      if (!result.ok) {
        showToast({ type: 'error', title: result.error.message });
        return false;
      }
      if (successTitle) showToast({ title: successTitle });
      return true;
    };

    return {
      changeStatus: (statusId, options) => {
        const result = api.updateCustomerStatus(customerId, { statusId, version });
        if (!handle(result)) return;
        if (!options?.shouldOfferUndo) {
          showToast({ title: `Đã chuyển tình trạng: ${result.data.status.label}` });
          return;
        }
        showToast({
          title: `Đã chuyển sang "${result.data.status.label}"`,
          message: 'Dữ liệu khách được giữ nguyên, có thể hoàn tác.',
          durationMs: UNDO_DURATION_MS,
          action: {
            label: 'Hoàn tác',
            onClick: () => {
              const undo = api.updateCustomerStatus(customerId, { statusId: result.data.previousStatusId, version: result.data.version });
              handle(undo, `Đã hoàn tác về "${status.label}"`);
            },
          },
        });
      },
      toggleCriterion: (key) => {
        handle(api.updateCustomerCriteria(customerId, { version, criteria: { [key]: { isDone: !criteria[key].isDone } } }));
      },
      saveCriterionDescription: (key, description) =>
        handle(api.updateCustomerCriteria(customerId, { version, criteria: { [key]: { description } } }), 'Đã lưu mô tả tiêu chí'),
      saveCareLog: (input) => handle(api.createCareLog(customerId, input), 'Đã lưu nhật ký chăm sóc'),
      revealNationalId: () => {
        const result = api.createNationalIdView(customerId);
        return handle(result) ? result.data.nationalId : null;
      },
      setOccasionReminder: (isOn) => {
        handle(
          api.updateCustomer(customerId, { version, shouldRemindOccasions: isOn }),
          isOn ? 'Đã bật nhắc dịp đặc biệt' : 'Đã tắt nhắc dịp đặc biệt',
        );
      },
    };
  }, [api, customerId, version, status.label, criteria, showToast]);
};
