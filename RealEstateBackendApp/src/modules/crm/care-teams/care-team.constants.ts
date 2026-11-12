/** Trạng thái đề nghị tham gia nhóm chăm sóc (`care_team_requests.status`, tài liệu 04 mục 3.5). */
export enum CareTeamRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELED = 'CANCELED',
}

export const JOIN_MESSAGE_MAX_LENGTH = 500;
export const RESOLUTION_NOTE_MAX_LENGTH = 500;
/** Số thành viên phụ (MEMBER) tối đa của một khách (FR-17); PRIMARY không tính. */
export const MAX_CARE_TEAM_MEMBERS = 10;
/** Số thành viên tối đa một lần thêm. */
export const MAX_MEMBERS_PER_ADD = 20;
