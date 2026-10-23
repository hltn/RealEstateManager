import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { UserStatus } from '../../../../common/enums/user-status.enum';
import { Team, TeamDocument } from '../../../teams/schemas/team.schema';
import { User, UserDocument } from '../../../users/schemas/user.schema';
import { CrmActor } from './crm-actor';

/**
 * Dựng `CrmActor` từ JWT: đọc lại người dùng + nhóm quản lý từ DB để vai trò/nhóm đổi có hiệu lực ngay
 * (access token sống tới 15 phút nên không thể tin team trong token).
 *
 * Tài khoản đã xóa mềm hoặc bị khóa => 401 ngay, không đợi token hết hạn.
 */
@Injectable()
export class CrmActorService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
  ) {}

  async resolve(jwt: Pick<JwtPayload, 'sub'>): Promise<CrmActor> {
    const user = await this.userModel
      .findOne({ _id: new Types.ObjectId(jwt.sub), deletedAt: null })
      .select('displayName role status teamId')
      .lean()
      .exec();
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Unauthorized');
    }

    const managedTeamIds =
      user.role === UserRole.MANAGER
        ? (
            await this.teamModel
              .find({ managerIds: user._id, deletedAt: null })
              .select('_id')
              .lean()
              .exec()
          ).map((team) => team._id)
        : [];

    return {
      userId: user._id,
      role: user.role,
      displayName: user.displayName,
      teamId: user.teamId ?? null,
      managedTeamIds,
    };
  }
}
