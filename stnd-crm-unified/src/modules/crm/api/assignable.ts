/**
 * Bất biến C8 dùng chung cho MỌI đường gán người chăm sóc (tạo khách, thêm/gỡ thành viên, đổi phụ trách chính,
 * bulk ASSIGN, import; luồng duyệt đề nghị tham gia đã gỡ ở v1.0.5): người được gán phải tồn tại, đang hoạt động và không phải Quản trị.
 */
import { findNonAssignableUserIds } from '@crm/lib/customerRules';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { Customer } from '@crm/types/crm';
import { buildAssigneeSource, getOwnerTeamIds, listAssignableAssignees } from './access';
import type { ApiError } from './types';

/** Thông báo mời người vào nhóm chăm sóc không hợp lệ: NGUYÊN VĂN của backend (`care-team-assignees.service`), không còn câu riêng của FE (FR-33). */
export const NOT_ASSIGNABLE_MESSAGE = 'Có người được phân không hợp lệ (không tồn tại, không hoạt động hoặc không phải Quản lý/Nhân viên)';

/** Lý do không giao được người thực hiện lịch hẹn (`details.reason` của `USER_NOT_ASSIGNABLE`, FR-30) + thông điệp NGUYÊN VĂN của backend. */
export type AssigneeRejectReason = 'NOT_IN_CARE_TEAM' | 'NOT_ACTIVE' | 'NOT_CRM_ROLE';
export const ASSIGNEE_REJECT_MESSAGES: Record<AssigneeRejectReason, string> = {
  NOT_IN_CARE_TEAM: 'Người thực hiện phải là thành viên nhóm chăm sóc, người tạo khách hoặc Quản lý của nhóm chủ khách; nhờ thành viên có quyền mời đưa người đó vào nhóm trước',
  NOT_ACTIVE: 'Người thực hiện không còn hoạt động (tài khoản bị khóa hoặc đã xóa)',
  NOT_CRM_ROLE: 'Người thực hiện không có vai trò CRM (cần là Quản trị, Quản lý hoặc Nhân viên)',
};

const hasCrmRole = (user: (CrmDataState['users'][number] & { roles?: readonly string[] }) | undefined): boolean =>
  Boolean(user) && (user?.roles ?? [user?.role]).some((role) => role === 'ADMIN' || role === 'MANAGER' || role === 'STAFF');

/** `null` = hợp lệ; ngược lại trả lỗi 400 `USER_NOT_ASSIGNABLE` kèm danh sách id vi phạm. */
export const assertAssignableUsers = (state: Pick<CrmDataState, 'users'>, userIds: readonly (string | null | undefined)[]): (ApiError & { userIds: string[] }) | null => {
  const invalid = findNonAssignableUserIds(state.users, userIds.filter((id): id is string => Boolean(id)));
  if (invalid.length === 0) return null;
  return { statusCode: 400, errorCode: 'USER_NOT_ASSIGNABLE', message: NOT_ASSIGNABLE_MESSAGE, details: { userIds: invalid }, userIds: invalid };
};

/**
 * Kiểm `assigneeIds` của lịch hẹn (FR-30) theo đúng thứ tự backend: ngoài tập hợp lệ của khách (kể cả id không tồn tại) -> `NOT_IN_CARE_TEAM`;
 * trong tập nhưng tài khoản không hoạt động -> `NOT_ACTIVE`; không có vai trò CRM -> `NOT_CRM_ROLE`. Tập hợp lệ = `listAssignableAssignees`
 * trên `buildAssigneeSource` (cùng nguồn với form). Danh sách rỗng = không có ai để giao (`NOT_IN_CARE_TEAM`, `userIds = []`).
 * `null` = hợp lệ; ngược lại lỗi 400 `USER_NOT_ASSIGNABLE` kèm `details.reason`.
 */
export const assertAssignableAssignees = (
  state: Pick<CrmDataState, 'users' | 'teams'>,
  customer: Pick<Customer, 'careTeam' | 'createdBy'>,
  assigneeIds: readonly string[],
): (ApiError & { userIds: string[] }) | null => {
  const reject = (reason: AssigneeRejectReason, userIds: string[]) => ({
    statusCode: 400,
    errorCode: 'USER_NOT_ASSIGNABLE',
    message: ASSIGNEE_REJECT_MESSAGES[reason],
    details: { userIds, reason },
    userIds,
  });
  if (assigneeIds.length === 0) return reject('NOT_IN_CARE_TEAM', []);
  const source = buildAssigneeSource(customer, state.users, state.teams);
  const allowed = new Set(listAssignableAssignees(source).map((option) => option.userId));
  const outside = assigneeIds.filter((userId) => !allowed.has(userId));
  const usersById = new Map(state.users.map((user) => [user.id, user]));
  if (outside.length === 0) {
    // Trong tập hợp lệ nhưng tài khoản không có vai trò CRM (dữ liệu cũ): vẫn từ chối, đúng nguyên nhân.
    const noCrmRole = assigneeIds.filter((userId) => !hasCrmRole(usersById.get(userId)));
    return noCrmRole.length > 0 ? reject('NOT_CRM_ROLE', noCrmRole) : null;
  }
  // Phân loại nguyên nhân: id không thuộc tập ứng viên (careTeam, Manager nhóm chủ, người tạo) bất kể trạng thái -> ngoài tập.
  const ownerTeamIds = new Set(getOwnerTeamIds(customer, state.users));
  const candidateIds = new Set<string>([
    customer.createdBy,
    ...customer.careTeam.map((member) => member.userId),
    ...state.teams.filter((team) => ownerTeamIds.has(team.id)).flatMap((team) => team.managerIds),
  ]);
  const notCandidate = outside.filter((userId) => !candidateIds.has(userId));
  if (notCandidate.length > 0) return reject('NOT_IN_CARE_TEAM', notCandidate);
  const inactive = outside.filter((userId) => !usersById.get(userId)?.isActive);
  if (inactive.length > 0) return reject('NOT_ACTIVE', inactive);
  return reject('NOT_CRM_ROLE', outside);
};
