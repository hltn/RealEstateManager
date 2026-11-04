/** Trạng thái đề nghị tham gia nhóm chăm sóc (`care_team_requests.status`, tài liệu 04 mục 3.5). */
export enum CareTeamRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELED = 'CANCELED',
}

/** Hộp xem đề nghị: `mine` = mình gửi, `to-review` = mình có quyền duyệt. */
export enum CareTeamRequestBox {
  MINE = 'mine',
  TO_REVIEW = 'to-review',
}

export const JOIN_MESSAGE_MAX_LENGTH = 500;
export const RESOLUTION_NOTE_MAX_LENGTH = 500;
/** Số thành viên tối đa một lần thêm. */
export const MAX_MEMBERS_PER_ADD = 20;
