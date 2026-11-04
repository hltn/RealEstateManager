import { HttpStatus, NotFoundException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { hasCrmTeamRole } from '../../common/utils/user-roles.util';
import { TeamDocument } from './schemas/team.schema';

/** Khử trùng danh sách ObjectId nhưng GIỮ thứ tự xuất hiện đầu tiên (phần tử đầu là nhóm chính). */
export const uniqueObjectIds = (ids: Types.ObjectId[]): Types.ObjectId[] => [
  ...new Map(ids.map((id) => [String(id), id])).values(),
];

/** Hai danh sách giống hệt nhau về giá trị VÀ thứ tự (thứ tự quyết định nhóm chính). */
export const sameIdList = (
  left: readonly Types.ObjectId[],
  right: readonly Types.ObjectId[],
): boolean =>
  left.length === right.length &&
  left.every((id, index) => String(id) === String(right[index]));

/** Chỉ tài khoản có ít nhất một role MANAGER/STAFF mới thuộc nhóm (400 nếu vi phạm). */
export function assertRolesCanJoinTeam(roles: readonly string[]): void {
  if (!hasCrmTeamRole(roles)) {
    throw new BusinessException(
      ErrorCode.VALIDATION_FAILED,
      'Chỉ tài khoản vai trò Quản lý hoặc Nhân viên mới thuộc một nhóm',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Kiểm các nhóm đích còn tồn tại và đang hoạt động (thiếu bất kỳ nhóm nào ⇒ 404), đồng thời "khóa ghi" chúng
 * (tăng `revision`): xóa nhóm cũng ghi vào document này nên gán-người và xóa-nhóm đồng thời xung đột ghi
 * (một bên bị retry và thấy trạng thái mới) thay vì cùng thành công rồi để người trỏ vào nhóm đã xóa.
 * Phải gọi trong transaction của caller.
 */
export async function lockActiveTeams(
  teamModel: Model<TeamDocument>,
  teamIds: Types.ObjectId[],
  session: ClientSession,
): Promise<void> {
  if (teamIds.length === 0) return;
  const found = await teamModel
    .countDocuments({ _id: { $in: teamIds }, deletedAt: null, isActive: true })
    .session(session)
    .exec();
  if (found !== teamIds.length) {
    throw new NotFoundException('Không tìm thấy nhóm');
  }
  await teamModel
    .updateMany(
      { _id: { $in: teamIds } },
      { $inc: { revision: 1 } },
      { session },
    )
    .exec();
}
