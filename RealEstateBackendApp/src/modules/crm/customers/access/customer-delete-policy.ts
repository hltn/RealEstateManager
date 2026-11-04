import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor, sharesAnyTeam } from '../../common/access/crm-actor';
import { CareRole } from '../customer.constants';
import { customerNotDropped, insufficientRole } from '../customer.errors';

/** Phần hồ sơ khách mà quyền xóa cần đọc. */
export interface DeletableCustomer {
  teamIds?: Types.ObjectId[];
  careTeam?: Array<{ userId: Types.ObjectId; role: CareRole }>;
}

/** Lý do bị từ chối xóa: không đủ quyền (403) hoặc khách không thuộc nhóm "Bỏ" (409). */
export type DeleteDenial = 'FORBIDDEN' | 'NOT_DROPPED';

export interface DeleteContext {
  /** Khách đang thuộc nhóm danh sách "Bỏ" (`listGroup = DROPPED`). */
  isDropped: boolean;
  /**
   * `true` (xóa hàng loạt): MỌI vai trò chỉ được xóa khách "Bỏ". `false` (xóa đơn): ADMIN/MANAGER giữ hành vi cũ
   * (không đòi tình trạng), riêng STAFF luôn phải là khách "Bỏ".
   */
  requireDropped: boolean;
}

/** Người phụ trách chính HIỆN TẠI của khách (nguồn sự thật là `careTeam`, không cần là người nhập khách). */
const isCurrentPrimary = (
  customer: DeletableCustomer,
  actor: CrmActor,
): boolean =>
  (customer.careTeam ?? []).some(
    (member) =>
      member.role === CareRole.PRIMARY && member.userId.equals(actor.userId),
  );

/** Điều kiện về NGƯỜI (không xét tình trạng khách). Nguồn luật duy nhất cho quyền xóa khách (tài liệu 09 mục 7.2). */
const ownsDeletion = (
  actor: CrmActor,
  customer: DeletableCustomer,
): boolean => {
  switch (actor.role) {
    case UserRole.ADMIN:
      return true;
    case UserRole.MANAGER:
      // KHÔNG dùng `buildCustomerScope`: phạm vi XEM của Quản lý còn gồm khách mình chỉ có mặt trong careTeam.
      return sharesAnyTeam(customer.teamIds ?? [], actor.managedTeamIds);
    case UserRole.STAFF:
      return isCurrentPrimary(customer, actor);
    default:
      return false;
  }
};

/**
 * Quyền xóa mềm một khách — DÙNG CHUNG cho xóa đơn (`DELETE /crm/customers/:id`), xóa hàng loạt (`type = DELETE`) và
 * cờ `permissions.canDelete` ở chi tiết khách, nên ba nơi không thể lệch nhau:
 * - ADMIN: mọi khách;
 * - MANAGER: chỉ khách có `teamIds` giao với `managedTeamIds` của mình;
 * - STAFF: chỉ khách mình là người phụ trách chính hiện tại VÀ khách thuộc nhóm "Bỏ";
 * - vai trò khác (EDITOR...): không.
 * Trả `null` khi được phép.
 */
export const getDeleteDenial = (
  actor: CrmActor,
  customer: DeletableCustomer,
  { isDropped, requireDropped }: DeleteContext,
): DeleteDenial | null => {
  if (!ownsDeletion(actor, customer)) return 'FORBIDDEN';
  if ((requireDropped || actor.role === UserRole.STAFF) && !isDropped) {
    return 'NOT_DROPPED';
  }
  return null;
};

/** Ném 403 `INSUFFICIENT_ROLE` / 409 `CUSTOMER_NOT_DROPPED` theo `getDeleteDenial`. */
export const assertCanDeleteCustomer = (
  actor: CrmActor,
  customer: DeletableCustomer,
  context: DeleteContext,
): void => {
  const denial = getDeleteDenial(actor, customer, context);
  if (denial === 'FORBIDDEN') throw insufficientRole();
  if (denial === 'NOT_DROPPED') throw customerNotDropped();
};
