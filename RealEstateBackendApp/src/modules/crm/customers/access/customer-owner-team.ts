import { Types } from 'mongoose';
import { uniqueObjectIds } from '../../../../common/utils/object-id.util';

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
