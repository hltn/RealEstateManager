/** Hàm thuần dựng lựa chọn cho ô lọc "Người phụ trách". */
import type { CrmUser } from '@crm/types/crm';

export interface AssigneeFilterOption {
  value: string;
  label: string;
}

/** Nguồn ô lọc: phần tử của `GET /crm/customer-assignees` (chỉ các trường cần dùng). */
export interface AssigneeFilterSource {
  id: string;
  displayName: string;
  isLocked: boolean;
}

export const LOCKED_ASSIGNEE_SUFFIX = ' (đã khóa)';

/**
 * Người trong ô LỌC: đúng danh sách `GET /crm/customer-assignees` (người xuất hiện trong nhóm chăm sóc của khách mình thấy), KHÔNG lọc
 * trạng thái — tài khoản đã khóa vẫn có để lọc khách cũ của họ (nhãn thêm "đã khóa"). Nhãn là `displayName` (endpoint không trả họ tên
 * đầy đủ). Gắn thêm chính người đăng nhập nếu thiếu (để chọn "của tôi"), trừ Quản trị (Quản trị không có khách riêng).
 */
export const buildAssigneeFilterOptions = (assignees: readonly AssigneeFilterSource[], self: CrmUser | null): AssigneeFilterOption[] => {
  const seen = new Set<string>();
  const options: AssigneeFilterOption[] = [];
  assignees.forEach((assignee) => {
    if (seen.has(assignee.id)) return;
    seen.add(assignee.id);
    options.push({ value: assignee.id, label: assignee.isLocked ? `${assignee.displayName}${LOCKED_ASSIGNEE_SUFFIX}` : assignee.displayName });
  });
  if (self && self.role !== 'ADMIN' && !seen.has(self.id)) options.push({ value: self.id, label: self.displayName });
  return options;
};
