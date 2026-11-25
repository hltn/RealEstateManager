import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { uniqueObjectIds } from '../../../../common/utils/object-id.util';
import { CrmActor } from '../../common/access/crm-actor';

/** Phần hồ sơ khách mà việc dựng "nhóm chủ" cần đọc. */
export interface OwnerTeamCustomer {
  createdBy?: Types.ObjectId | null;
  /** Dự phòng cho khách cũ thiếu `createdBy` (hoặc không tìm thấy người tạo). */
  teamIds?: readonly Types.ObjectId[] | null;
}

/** Phần tài khoản người tạo khách mà việc xác định nhóm chủ cần đọc. */
export interface OwnerTeamCreator {
  teamId?: Types.ObjectId | null;
  teamIds?: readonly Types.ObjectId[] | null;
}

/**
 * Nhóm chủ của khách (FR-30, FR-32): nhóm của NGƯỜI TẠO (`createdBy`), cố định, không đổi khi đổi PRIMARY. Người tạo
 * không thuộc nhóm nào (ví dụ Admin thuần) thì KHÔNG có nhóm chủ (không dự phòng sang `teamIds` của khách). Khách cũ
 * thiếu `createdBy`, hoặc không tìm thấy người tạo (`creator = null`), thì dự phòng `customer.teamIds`.
 */
export const ownerTeamIdsOf = (
  customer: OwnerTeamCustomer,
  creator: OwnerTeamCreator | null,
): Types.ObjectId[] => {
  if (!customer.createdBy || !creator) {
    return uniqueObjectIds(customer.teamIds ?? []);
  }
  return uniqueObjectIds([
    ...(creator.teamIds ?? []),
    ...(creator.teamId ? [creator.teamId] : []),
  ]);
};

/** `userId` là người tạo khách (so id; không đọc `careTeam`). Khách thiếu `createdBy` thì không ai là người tạo. */
export const isCreator = (
  customer: Pick<OwnerTeamCustomer, 'createdBy'>,
  userId: Types.ObjectId,
): boolean => customer.createdBy != null && customer.createdBy.equals(userId);

/** `userId` nằm trong danh sách Manager của (các) nhóm chủ (`managerIds` đã loại nhóm xóa mềm). */
export const isOwnerManager = (
  ownerManagerIds: readonly Types.ObjectId[],
  userId: Types.ObjectId,
): boolean => ownerManagerIds.some((managerId) => managerId.equals(userId));

/**
 * Quyền CHỦ KHÁCH (FR-31): xem CMND/CCCD, mời/gỡ thành viên `careTeam` (hàm thuần; nơi gọi nạp sẵn `ownerManagerIds`
 * bằng `CustomerOwnerTeamService.loadCandidates`). Chỉ ba đối tượng, KHÔNG xét `careTeam` (PRIMARY/MEMBER không tự có):
 * - ADMIN;
 * - người tạo khách (`createdBy`), mọi vai trò;
 * - MANAGER nằm trong `managerIds` của nhóm chủ (nhóm của người tạo), kể cả khi chưa trong `careTeam`.
 * Người tạo không có nhóm thì `ownerManagerIds` rỗng nên không có Manager nhóm chủ.
 */
export const hasOwnerRights = (
  actor: Pick<CrmActor, 'userId' | 'role'>,
  customer: Pick<OwnerTeamCustomer, 'createdBy'>,
  ownerManagerIds: readonly Types.ObjectId[],
): boolean =>
  actor.role === UserRole.ADMIN ||
  isCreator(customer, actor.userId) ||
  (actor.role === UserRole.MANAGER &&
    isOwnerManager(ownerManagerIds, actor.userId));
