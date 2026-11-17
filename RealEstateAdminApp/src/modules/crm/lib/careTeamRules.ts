/** Quy tắc nhóm chăm sóc v1.0.5 (hàm thuần): giới hạn thành viên phụ và lời báo lỗi theo mã. */
import type { ApiError, CareTeamMemberView } from '@crm/api';

/** Tối đa 10 thành viên phụ (MEMBER) mỗi khách; PRIMARY không tính (FR-11). */
export const MAX_CARE_TEAM_MEMBERS = 10;

/** Số thành viên phụ (MEMBER) hiện có. */
export const countCareTeamMembers = (careTeam: Pick<CareTeamMemberView, 'role'>[]): number => careTeam.filter((member) => member.role === 'MEMBER').length;

/** Còn mời thêm được bao nhiêu người (không âm). */
export const getRemainingMemberSlots = (careTeam: Pick<CareTeamMemberView, 'role'>[]): number => Math.max(0, MAX_CARE_TEAM_MEMBERS - countCareTeamMembers(careTeam));

const CARE_TEAM_ERROR_MESSAGES: Record<string, string> = {
  CARE_TEAM_LIMIT_EXCEEDED: `Nhóm chăm sóc đã đủ ${MAX_CARE_TEAM_MEMBERS} thành viên phụ. Hãy gỡ bớt trước khi mời thêm.`,
  PRIMARY_LOCKED: 'Người chăm sóc chính đã được cố định, không đổi hoặc gỡ được.',
  PRIMARY_REQUIRED: 'Khách chưa có người chăm sóc chính. Hãy đặt người chăm sóc chính ở hồ sơ khách trước.',
  CARE_TEAM_ACTION_FORBIDDEN: 'Bạn không có quyền thay đổi nhóm chăm sóc của khách này.',
};

/** Câu báo khi gỡ người tạo khách (409 `PRIMARY_LOCKED` kèm `details.reason = CREATOR_LOCKED`, FR-31). */
export const CREATOR_LOCKED_MESSAGE = 'Người tạo khách luôn ở trong nhóm chăm sóc, không gỡ được.';

/**
 * Lời báo cho lỗi nhóm chăm sóc: ưu tiên bản tiếng Việt theo mã; mã lạ và `USER_NOT_ASSIGNABLE` dùng NGUYÊN VĂN thông báo của backend
 * (FR-33, không còn câu chung chung của FE). `PRIMARY_LOCKED` + `details.reason = CREATOR_LOCKED` có câu riêng cho người tạo khách.
 */
export const describeCareTeamError = (error: Pick<ApiError, 'message'> & { errorCode?: string; details?: Record<string, unknown> }): string => {
  if (error.errorCode === 'PRIMARY_LOCKED' && error.details?.reason === 'CREATOR_LOCKED') return CREATOR_LOCKED_MESSAGE;
  return (error.errorCode && CARE_TEAM_ERROR_MESSAGES[error.errorCode]) || error.message;
};

/**
 * Lý do ngắn (đặt sau tên khách) cho kết quả thêm người hàng loạt theo từng khách.
 * Backend (`BulkFailureDto`) chỉ trả `{ customerId, errorCode }`, KHÔNG có `details.reason`, nên `USER_NOT_ASSIGNABLE` ở đây
 * chỉ có một câu chung (không tách được nguyên nhân: người không tồn tại / không hoạt động / không phải Quản lý-Nhân viên).
 */
const BULK_ASSIGN_REASONS: Record<string, string> = {
  CARE_TEAM_LIMIT_EXCEEDED: `nhóm đã đủ ${MAX_CARE_TEAM_MEMBERS} thành viên phụ`,
  PRIMARY_REQUIRED: 'chưa có người chăm sóc chính (hãy đặt ở hồ sơ khách)',
  CUSTOMER_NOT_FOUND: 'không còn trong phạm vi của bạn',
  USER_NOT_ASSIGNABLE: 'người được chọn không thể tham gia nhóm',
  CARE_TEAM_ACTION_FORBIDDEN: 'bạn không có quyền với khách này',
  // FR-31: mời hàng loạt kiểm riêng từng khách; không phải chủ khách (Quản trị, người tạo, Quản lý nhóm chủ) bị từ chối.
  INSUFFICIENT_ROLE: 'chỉ Quản trị, người tạo khách hoặc Quản lý nhóm chủ mới mời được vào nhóm của khách này',
  VALIDATION_FAILED: 'dữ liệu không hợp lệ',
};

export const describeBulkAssignError = (errorCode: string): string => BULK_ASSIGN_REASONS[errorCode] ?? 'không áp dụng được';
