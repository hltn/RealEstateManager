import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { CRM_TEAM_ROLES } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { escapeRegex } from '../../../common/utils/regex.util';
import { Team, TeamDocument } from '../../teams/schemas/team.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { resolveVisibleTeamIds } from '../common/access/crm-actor';
import { CrmActorService } from '../common/access/crm-actor.service';
import {
  AssignableUserResponseDto,
  ListAssignableUsersQueryDto,
} from './dtos/assignable-users.dto';

const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Người có thể được phân chăm sóc khách (`GET /crm/assignable-users`, tài liệu 05 mục 2.2).
 * Chỉ MANAGER/STAFF đang hoạt động (khớp lỗi `USER_NOT_ASSIGNABLE`). Phạm vi theo người gọi:
 * Quản trị thấy tất cả; Quản lý thấy nhóm mình quản lý + nhóm mình thuộc; Nhân viên chỉ thấy nhóm mình.
 * Chỉ trả id + tên hiển thị + vai trò + nhóm — không lộ email.
 */
@Injectable()
export class AssignableUsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    private readonly actors: CrmActorService,
  ) {}

  async list(
    jwt: JwtPayload,
    query: ListAssignableUsersQueryDto,
  ): Promise<{ data: AssignableUserResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const emptyResult = { data: [], meta: buildPaginationMeta(0, page, limit) };

    const actor = await this.actors.resolve(jwt);
    const visibleTeamIds = resolveVisibleTeamIds(actor);
    // Vai trò ngoài CRM hoặc chưa thuộc nhóm nào: không có ai trong phạm vi.
    if (visibleTeamIds !== null && visibleTeamIds.length === 0)
      return emptyResult;

    const filter: Record<string, unknown> = {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      role: { $in: CRM_TEAM_ROLES },
    };

    // Phạm vi nhóm; nếu client lọc thêm teamId thì phải nằm trong phạm vi (không dùng để dò nhóm khác).
    const requestedTeamId = query.teamId
      ? new Types.ObjectId(query.teamId)
      : null;
    if (visibleTeamIds !== null) {
      if (
        requestedTeamId &&
        !visibleTeamIds.some((id) => id.equals(requestedTeamId))
      ) {
        return emptyResult;
      }
      filter.teamId = requestedTeamId ?? { $in: visibleTeamIds };
    } else if (requestedTeamId) {
      filter.teamId = requestedTeamId;
    }
    if (query.q) filter.displayName = new RegExp(escapeRegex(query.q), 'i');

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('displayName role teamId')
        .collation(VIETNAMESE_COLLATION)
        .sort({ displayName: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    const teamIds = [
      ...new Map(
        users
          .filter((user) => user.teamId)
          .map((user) => [String(user.teamId), user.teamId as Types.ObjectId]),
      ).values(),
    ];
    const teams = teamIds.length
      ? await this.teamModel
          .find({ _id: { $in: teamIds } })
          .select('name')
          .lean()
          .exec()
      : [];
    const teamNameById = new Map(
      teams.map((team) => [String(team._id), team.name]),
    );

    return {
      data: users.map((user) => ({
        id: String(user._id),
        displayName: user.displayName,
        role: user.role,
        team: user.teamId
          ? {
              id: String(user.teamId),
              label: teamNameById.get(String(user.teamId)) ?? '',
            }
          : null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}
