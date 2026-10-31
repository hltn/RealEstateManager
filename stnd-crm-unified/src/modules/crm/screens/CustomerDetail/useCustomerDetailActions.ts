/**
 * Thao tác ghi của màn "Chi tiết khách hàng" (dùng chung desktop + mobile).
 * Gọi lớp dữ liệu `useCrmApi()` (API thật) + toast kết quả tiếng Việt; component con tự gọi, không truyền callback nhiều cấp.
 * Xung đột phiên bản (409 `VERSION_CONFLICT`): hiện hướng dẫn (`describeWriteError`); lớp ghi luôn làm mới dữ liệu sau mỗi lần ghi
 * (kể cả lỗi) nên `version` mới có sẵn cho lần thao tác kế tiếp.
 */
import { useMemo } from 'react';
import { describeWriteError, useCrmApi, type ApiResult, type CreateCareLogInput, type CustomerDetail } from '@crm/api';
import { useCrmActions } from '@crm/store';
import type { CriterionKey } from '@crm/types/crm';

export interface CustomerDetailActions {
  /** Đổi tình trạng (gửi `version`); `shouldOfferUndo` = hiện nút "Hoàn tác" trong toast (02 §5). */
  changeStatus: (statusId: string, options?: { shouldOfferUndo?: boolean }) => Promise<void>;
  /** Đảo dấu hoàn thành 1 tiêu chí (tiến độ do server tính lại). */
  toggleCriterion: (key: CriterionKey) => Promise<void>;
  /** Lưu mô tả 1 tiêu chí; trả `true` nếu đã lưu. */
  saveCriterionDescription: (key: CriterionKey, description: string) => Promise<boolean>;
  /** Lưu nhật ký; trả `true` nếu đã lưu. */
  saveCareLog: (input: CreateCareLogInput) => Promise<boolean>;
  /** Xem CCCD đầy đủ (server kiểm quyền + ghi log); null nếu không được phép/không có. */
  revealNationalId: () => Promise<string | null>;
}

const UNDO_DURATION_MS = 10_000;

export const useCustomerDetailActions = (customer: Pick<CustomerDetail, 'id' | 'version' | 'status' | 'criteria' | 'careTeam'>): CustomerDetailActions => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const { id: customerId, version, status, criteria, careTeam } = customer;
  const primaryUserId = careTeam.find((member) => member.role === 'PRIMARY')?.user.id ?? null;

  return useMemo(() => {
    /** Báo lỗi API bằng toast tiếng Việt dễ hiểu (02 §8: không hiện mã lỗi). */
    const handle = <T,>(result: ApiResult<T>, successTitle?: string): result is { ok: true; data: T } => {
      if (!result.ok) {
        showToast({ type: 'error', title: describeWriteError(result.error) });
        return false;
      }
      if (successTitle) showToast({ title: successTitle });
      return true;
    };

    return {
      changeStatus: async (statusId, options) => {
        const result = await api.updateCustomerStatus(customerId, { statusId, version });
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
            onClick: async () => {
              const undo = await api.updateCustomerStatus(customerId, { statusId: result.data.previousStatusId, version: result.data.version });
              handle(undo, `Đã hoàn tác về "${status.label}"`);
            },
          },
        });
      },
      toggleCriterion: async (key) => {
        handle(await api.updateCustomerCriteria(customerId, { version, criteria: { [key]: { isDone: !criteria[key].isDone } } }));
      },
      saveCriterionDescription: async (key, description) =>
        handle(await api.updateCustomerCriteria(customerId, { version, criteria: { [key]: { description } } }), 'Đã lưu mô tả tiêu chí'),
      saveCareLog: async (input) => handle(await api.createCareLog(customerId, input, primaryUserId), 'Đã lưu nhật ký chăm sóc'),
      revealNationalId: async () => {
        const result = await api.createNationalIdView(customerId);
        return handle(result) ? result.data.nationalId : null;
      },
    };
  }, [api, customerId, version, status.label, criteria, primaryUserId, showToast]);
};
