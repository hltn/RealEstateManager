/** Hàm thuần dựng lựa chọn cho ô lọc "Người phụ trách". */
import type { CrmUser } from '@crm/types/crm';

export interface AssigneeFilterOption {
  value: string;
  label: string;
}

/** Hậu tố nhãn người bị khóa trong ô lọc (cùng chữ "(đã khóa)" của `CustomerCard`); lựa chọn vẫn chọn được để lọc khách cũ của họ. */
export const LOCKED_ASSIGNEE_SUFFIX = ' (đã khóa)';

/**
 * Người trong ô LỌC: đúng danh sách máy chủ trả cho `purpose=filter` (đang hoạt động, khử trùng), KHÔNG loại ADMIN — người lọc có thể
 * là ADMIN/EDITOR cũ còn nằm trong careTeam của khách. Gắn thêm chính người đăng nhập nếu thiếu (để chọn "của tôi"), trừ Quản trị
 * (Quản trị không có khách riêng nên không thêm vào ô lọc như trước đây). Tài khoản bị khóa (`isLocked`) vẫn có trong danh sách,
 * nhãn gắn thêm `LOCKED_ASSIGNEE_SUFFIX` (dùng chung cho ô chọn nhanh `<select>` và nhóm chip ở bộ lọc nâng cao, cả desktop lẫn mobile).
 */
export const buildAssigneeFilterOptions = (users: readonly CrmUser[], self: CrmUser | null): AssigneeFilterOption[] => {
  const seen = new Set<string>();
  const options: AssigneeFilterOption[] = [];
  const push = (user: CrmUser) => {
    if (!user.isActive || seen.has(user.id)) return;
    seen.add(user.id);
    options.push({ value: user.id, label: user.isLocked ? `${user.fullName}${LOCKED_ASSIGNEE_SUFFIX}` : user.fullName });
  };
  users.forEach(push);
  if (self && self.role !== 'ADMIN') push(self);
  return options;
};
