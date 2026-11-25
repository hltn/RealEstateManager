import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor } from '../../common/access/crm-actor';
import { insufficientRole } from '../customer.errors';
import { isCreator } from './customer-owner-team';

/** Phần hồ sơ khách mà quyền xóa cần đọc: chỉ người tạo. */
export interface DeletableCustomer {
  createdBy?: Types.ObjectId | null;
}

/** Lý do bị từ chối xóa: không đủ quyền (403). Không còn lý do theo tình trạng khách (D9, FR-31). */
export type DeleteDenial = 'FORBIDDEN';

/**
 * Quyền xóa mềm một khách (FR-31) — DÙNG CHUNG cho xóa đơn (`DELETE /crm/customers/:id`), xóa hàng loạt
 * (`type = DELETE`) và cờ `permissions.canDelete` ở chi tiết khách, nên ba nơi không thể lệch nhau:
 * - ADMIN: mọi khách;
 * - NGƯỜI TẠO (`createdBy`): khách mình tạo, mọi vai trò CRM;
 * - mọi người khác (Manager nhóm chủ, PRIMARY, MEMBER, Staff khác): KHÔNG.
 * KHÔNG điều kiện trạng thái khách (D9): khách thuộc nhóm nào cũng xóa được nếu đủ quyền.
 * Trả `null` khi được phép.
 */
export const getDeleteDenial = (
  actor: CrmActor,
  customer: DeletableCustomer,
): DeleteDenial | null =>
  actor.role === UserRole.ADMIN || isCreator(customer, actor.userId)
    ? null
    : 'FORBIDDEN';

/** Ném 403 `INSUFFICIENT_ROLE` theo `getDeleteDenial`. */
export const assertCanDeleteCustomer = (
  actor: CrmActor,
  customer: DeletableCustomer,
): void => {
  if (getDeleteDenial(actor, customer) !== null) throw insufficientRole();
};
