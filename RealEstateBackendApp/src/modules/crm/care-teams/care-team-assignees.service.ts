import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CRM_TEAM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { CrmActor } from '../common/access/crm-actor';

/** Thông tin tối thiểu của người dùng cần để kiểm tra phân công và tính `teamIds`. */
export interface AssigneeInfo {
  _id: Types.ObjectId;
  role: UserRole;
  status: UserStatus;
  teamId: Types.ObjectId | null;
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

  /** Đọc `role/status/teamId` của nhiều người trong một lần (chống N+1); bỏ qua tài khoản đã xóa mềm. */
  async load(
    userIds: Types.ObjectId[],
    session: ClientSession,
  ): Promise<Map<string, AssigneeInfo>> {
    if (userIds.length === 0) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: userIds }, deletedAt: null })
      .select('role status teamId')
      .session(session)
      .lean()
      .exec();
    return new Map(
      users.map((user) => [
        String(user._id),
        {
          _id: user._id,
          role: user.role,
          status: user.status,
          teamId: user.teamId ?? null,
        },
      ]),
    );
  }

  /**
   * Người được phân phải ACTIVE và là MANAGER/STAFF. Khi `restrictToActorScope`:
   * Quản lý chỉ phân cho người trong nhóm mình quản lý (hoặc chính mình), Nhân viên (phụ trách chính) chỉ phân cho
   * người cùng nhóm — khớp danh sách `assignable-users` mà giao diện cho chọn. Quản trị không bị giới hạn.
   * Sai ⇒ 400 `USER_NOT_ASSIGNABLE` kèm danh sách `userIds` không hợp lệ.
   */
  assertAssignable(
    actor: CrmActor,
    userIds: Types.ObjectId[],
    users: Map<string, AssigneeInfo>,
    restrictToActorScope: boolean,
  ): void {
    const invalid = userIds.filter((id) => {
      const user = users.get(String(id));
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !CRM_TEAM_ROLES.includes(user.role)
      ) {
        return true;
      }
      if (!restrictToActorScope || actor.role === UserRole.ADMIN) return false;
      if (id.equals(actor.userId)) return false;
      if (actor.role === UserRole.MANAGER) {
        return !actor.managedTeamIds.some((team) => user.teamId?.equals(team));
      }
      return !actor.teamId || !user.teamId?.equals(actor.teamId);
    });
    if (invalid.length > 0) {
      throw new BusinessException(
        ErrorCode.USER_NOT_ASSIGNABLE,
        'Có người được phân không hợp lệ (không hoạt động, không phải Quản lý/Nhân viên hoặc ngoài phạm vi bạn được phân)',
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
