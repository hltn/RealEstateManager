/** Quy tắc nhóm chăm sóc v1.0.5 (hàm thuần): giới hạn thành viên phụ và lời báo lỗi theo mã. */
import type { CareTeamMemberView } from '@crm/api';

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
  USER_NOT_ASSIGNABLE: 'Người được chọn không thể tham gia nhóm chăm sóc (tài khoản không còn hoạt động).',
  CARE_TEAM_ACTION_FORBIDDEN: 'Bạn không có quyền thay đổi nhóm chăm sóc của khách này.',
};

/** Lời báo cho lỗi nhóm chăm sóc: ưu tiên bản tiếng Việt theo mã; mã lạ dùng thông báo của lớp dữ liệu. */
export const describeCareTeamError = (error: { errorCode?: string; message: string }): string => (error.errorCode && CARE_TEAM_ERROR_MESSAGES[error.errorCode]) || error.message;

/** Lý do ngắn (đặt sau tên khách) cho kết quả thêm người hàng loạt theo từng khách. */
const BULK_ASSIGN_REASONS: Record<string, string> = {
  CARE_TEAM_LIMIT_EXCEEDED: `nhóm đã đủ ${MAX_CARE_TEAM_MEMBERS} thành viên phụ`,
  PRIMARY_REQUIRED: 'chưa có người chăm sóc chính (hãy đặt ở hồ sơ khách)',
  CUSTOMER_NOT_FOUND: 'không còn trong phạm vi của bạn',
  USER_NOT_ASSIGNABLE: 'người được chọn không thể tham gia nhóm',
  CARE_TEAM_ACTION_FORBIDDEN: 'bạn không có quyền với khách này',
  VALIDATION_FAILED: 'dữ liệu không hợp lệ',
};

export const describeBulkAssignError = (errorCode: string): string => BULK_ASSIGN_REASONS[errorCode] ?? 'không áp dụng được';
