/**
 * Người thực hiện lịch hẹn (FR-30, v1.0.6): MỘT nguồn thuần dùng chung cho ô chọn (`AssigneeField`), mặc định và kiểm hợp lệ.
 * Tập hợp lệ khớp backend (`resolveAssignees`): careTeam ACTIVE ∪ Manager nhóm chủ (`ownerManagers`) ∪ người tạo khách (`creator`,
 * mọi vai trò, kể cả ngoài careTeam), khử trùng theo userId. `ownerManagers`/`creator` do backend đã lọc ACTIVE; thành viên careTeam
 * có `isLocked` là tài khoản đã khóa nên bị loại.
 */
import type { CustomerDetail } from '@crm/api';

/** Số người thực hiện tối đa mỗi lịch hẹn (khớp `assigneeIds` 1..20 của backend). */
export const MAX_APPOINTMENT_ASSIGNEES = 20;

export type AssigneeSource = 'PRIMARY' | 'MEMBER' | 'OWNER_MANAGER' | 'CREATOR';

export interface AssigneeOption {
  userId: string;
  fullName: string;
  source: AssigneeSource;
  /** Nhãn hiển thị trong ô chọn. */
  label: string;
}

/** Phần chi tiết khách mà hàm cần (dễ dựng trong test). */
export type AssigneeSourceCustomer = Pick<CustomerDetail, 'careTeam' | 'ownerManagers' | 'creator'>;

const SOURCE_SUFFIX: Record<AssigneeSource, string> = {
  PRIMARY: ' (phụ trách chính)',
  MEMBER: '',
  OWNER_MANAGER: ' (quản lý nhóm)',
  CREATOR: ' (người tạo khách)',
};

/** Danh sách người thực hiện chọn được cho khách; khách `null` hoặc chưa tải xong = rỗng. */
export const listAssignableAssignees = (customer: AssigneeSourceCustomer | null): AssigneeOption[] => {
  if (!customer) return [];
  const result = new Map<string, AssigneeOption>();
  const add = (userId: string, fullName: string, source: AssigneeSource) => {
    if (result.has(userId)) return;
    result.set(userId, { userId, fullName, source, label: `${fullName}${SOURCE_SUFFIX[source]}` });
  };
  for (const member of customer.careTeam) {
    if (member.user.isLocked) continue;
    add(member.user.id, member.user.fullName, member.role === 'PRIMARY' ? 'PRIMARY' : 'MEMBER');
  }
  for (const manager of customer.ownerManagers) add(manager.userId, manager.fullName, 'OWNER_MANAGER');
  if (customer.creator) add(customer.creator.userId, customer.creator.fullName, 'CREATOR');
  return [...result.values()];
};

/**
 * Mặc định: người tạo lịch nếu thuộc danh sách; không thì phụ trách chính (chưa khóa); chưa có PRIMARY thì để trống
 * (Admin khác ngoài danh sách KHÔNG tự chọn mình).
 */
export const getDefaultAssigneeIds = (options: readonly AssigneeOption[], currentUserId: string): string[] => {
  if (options.some((option) => option.userId === currentUserId)) return [currentUserId];
  const primary = options.find((option) => option.source === 'PRIMARY');
  return primary ? [primary.userId] : [];
};

/** Lỗi kiểm `assigneeIds` (1..20, đều thuộc danh sách); `null` = hợp lệ. */
export const validateAssigneeIds = (assigneeIds: readonly string[], options: readonly AssigneeOption[]): string | null => {
  if (assigneeIds.length === 0) return 'Chọn ít nhất 1 người thực hiện.';
  if (assigneeIds.length > MAX_APPOINTMENT_ASSIGNEES) return `Tối đa ${MAX_APPOINTMENT_ASSIGNEES} người thực hiện mỗi lịch hẹn.`;
  const allowed = new Set(options.map((option) => option.userId));
  if (assigneeIds.some((userId) => !allowed.has(userId))) return 'Có người thực hiện không còn thuộc danh sách của khách này. Vui lòng chọn lại.';
  return null;
};

/** Tên các người thực hiện để hiển thị trên thẻ lịch hẹn/việc ("A, B"); chưa có ai thì "—". */
export const formatAssigneeNames = (assignees: readonly { displayName: string }[]): string =>
  assignees.length > 0 ? assignees.map((assignee) => assignee.displayName).join(', ') : '—';
