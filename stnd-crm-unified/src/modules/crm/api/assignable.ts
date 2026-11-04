/**
 * Bất biến C8 dùng chung cho MỌI đường gán người chăm sóc (tạo khách, thêm/gỡ thành viên, đổi phụ trách chính,
 * bulk ASSIGN, duyệt đề nghị, import): người được gán phải tồn tại, đang hoạt động và không phải Quản trị.
 */
import { findNonAssignableUserIds } from '@crm/lib/customerRules';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { ApiError } from './types';

export const NOT_ASSIGNABLE_MESSAGE = 'Người được chọn không thể phân chăm sóc (không tồn tại, đã khoá hoặc là Quản trị).';

/** `null` = hợp lệ; ngược lại trả lỗi 400 `USER_NOT_ASSIGNABLE` kèm danh sách id vi phạm. */
export const assertAssignableUsers = (state: Pick<CrmDataState, 'users'>, userIds: readonly (string | null | undefined)[]): (ApiError & { userIds: string[] }) | null => {
  const invalid = findNonAssignableUserIds(state.users, userIds.filter((id): id is string => Boolean(id)));
  if (invalid.length === 0) return null;
  return { statusCode: 400, errorCode: 'USER_NOT_ASSIGNABLE', message: NOT_ASSIGNABLE_MESSAGE, details: { userIds: invalid }, userIds: invalid };
};
