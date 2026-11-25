import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { hasCrmTeamRole, rolesOf } from '../../../common/utils/user-roles.util';
import { teamObjectIdsOf } from '../../users/user-public-profile';

/** Thông tin tối thiểu của người dùng cần để kiểm tra phân công và tính `teamIds`. */
export interface AssigneeInfo {
  _id: Types.ObjectId;
  /** Mọi role của người này (được phân khi có ít nhất một role MANAGER/STAFF). */
  roles: UserRole[];
  status: UserStatus;
  /** Mọi nhóm của người này. */
  teamIds: Types.ObjectId[];
}

/**
 * Kiểm tra và khóa ghi người được phân vào nhóm chăm sóc (dùng chung cho thêm thành viên, đổi phụ trách chính,
 * duyệt đề nghị và phân hàng loạt).
 */
@Injectable()
export class CareTeamAssigneesService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** Đọc `roles/status/teamIds` của nhiều người trong một lần (chống N+1); bỏ qua tài khoản đã xóa mềm. */
  async load(
    userIds: Types.ObjectId[],
    session: ClientSession,
  ): Promise<Map<string, AssigneeInfo>> {
    if (userIds.length === 0) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: userIds }, deletedAt: null })
      .select('role roles status teamId teamIds')
      .session(session)
      .lean()
      .exec();
    return new Map(
      users.map((user) => [
        String(user._id),
        {
          _id: user._id,
          roles: rolesOf(user) as UserRole[],
          status: user.status,
          teamIds: teamObjectIdsOf(user),
        },
      ]),
    );
  }

  /**
   * Người được phân phải tồn tại và chưa xóa mềm (`load` đã loại tài khoản xóa mềm nên vắng mặt trong `users`),
   * ACTIVE và có role MANAGER/STAFF. KHÔNG còn giới hạn theo nhóm của người mời (FR-13): Nhân viên PRIMARY, Quản lý
   * và Quản trị đều mời được người ở nhóm khác. Sai ⇒ 400 `USER_NOT_ASSIGNABLE` kèm danh sách `userIds` không hợp lệ.
   */
  assertAssignable(
    userIds: Types.ObjectId[],
    users: Map<string, AssigneeInfo>,
  ): void {
    const invalid = userIds.filter((id) => {
      const user = users.get(String(id));
      return (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !hasCrmTeamRole(user.roles)
      );
    });
    if (invalid.length > 0) {
      throw new BusinessException(
        ErrorCode.USER_NOT_ASSIGNABLE,
        'Có người được phân không hợp lệ (không tồn tại, không hoạt động hoặc không phải Quản lý/Nhân viên)',
        HttpStatus.BAD_REQUEST,
        { userIds: invalid.map(String) },
      );
    }
  }

  /**
   * "Chạm" document người được phân (cập nhật `updatedAt`) để việc đổi nhóm/vai trò của họ chạy đồng thời xung đột ghi
   * và buộc một bên retry — tránh `customers.teamIds` lệch nhóm hiện tại của người chăm sóc (write-skew, như M2).
   */
  async lock(userIds: Types.ObjectId[], session: ClientSession): Promise<void> {
    if (userIds.length === 0) return;
    await this.userModel
      .updateMany(
        { _id: { $in: userIds } },
        { $currentDate: { updatedAt: true } },
        { session, timestamps: false },
      )
      .exec();
  }
}
