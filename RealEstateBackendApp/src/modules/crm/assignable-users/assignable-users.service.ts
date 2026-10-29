import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { CRM_TEAM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { escapeRegex } from '../../../common/utils/regex.util';
import { highestRole, rolesOf } from '../../../common/utils/user-roles.util';
import { Team, TeamDocument } from '../../teams/schemas/team.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { teamIdsOf, teamObjectIdsOf } from '../../users/user-public-profile';
import { resolveAssignableTeamIds } from '../common/access/crm-actor';
import { CrmActorService } from '../common/access/crm-actor.service';
import {
  AssignableUserResponseDto,
  ListAssignableUsersQueryDto,
} from './dtos/assignable-users.dto';

const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Người có thể được phân chăm sóc khách (`GET /crm/assignable-users`, tài liệu 05 mục 2.2).
 * Chỉ người có role MANAGER/STAFF đang hoạt động (khớp lỗi `USER_NOT_ASSIGNABLE`); người nhiều nhóm xuất hiện khi lọc theo
 * bất kỳ nhóm nào của họ. Phạm vi theo người gọi KHỚP đúng luật của `assertAssignable` (`resolveAssignableTeamIds`): chỉ
 * liệt kê người mà thao tác phân chăm sóc sau đó được chấp nhận. Quản trị thấy tất cả; Quản lý thấy người thuộc nhóm mình
 * QUẢN LÝ (không gồm nhóm mình chỉ là thành viên); Nhân viên thấy người cùng nhóm; Quản lý/Nhân viên luôn thấy chính mình.
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
    const scopeTeamIds = resolveAssignableTeamIds(actor);
    // Chỉ Quản lý/Nhân viên mới phân/được phân; vai trò khác không có ai trong phạm vi.
    if (
      scopeTeamIds !== null &&
      actor.role !== UserRole.MANAGER &&
      actor.role !== UserRole.STAFF
    ) {
      return emptyResult;
    }

    const filter: Record<string, unknown> = {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      roles: { $in: CRM_TEAM_ROLES },
    };

    // Phạm vi nhóm; nếu client lọc thêm teamId thì phải nằm trong phạm vi (không dùng để dò nhóm khác).
    const requestedTeamId = query.teamId
      ? new Types.ObjectId(query.teamId)
      : null;
    if (scopeTeamIds !== null) {
      if (
        requestedTeamId &&
        !scopeTeamIds.some((id) => id.equals(requestedTeamId))
      ) {
        return emptyResult;
      }
      // Không lọc nhóm cụ thể: thêm chính mình (luôn được phân cho chính mình dù không thuộc nhóm trong phạm vi).
      if (requestedTeamId) {
        filter.teamIds = requestedTeamId;
      } else {
        filter.$or = [
          { teamIds: { $in: scopeTeamIds } },
          { _id: actor.userId },
        ];
      }
    } else if (requestedTeamId) {
      filter.teamIds = requestedTeamId;
    }
    if (query.q) filter.displayName = new RegExp(escapeRegex(query.q), 'i');

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('displayName role roles teamId teamIds')
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
          .flatMap((user) => teamObjectIdsOf(user))
          .map((id) => [String(id), id]),
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
      data: users.map((user) => {
        const userTeamIds = teamIdsOf(user);
        const toRef = (id: string) => ({
          id,
          label: teamNameById.get(id) ?? '',
        });
        return {
          id: String(user._id),
          displayName: user.displayName,
          // `role` giữ hợp đồng cũ (MANAGER/STAFF): role cao nhất trong các role được phân chăm sóc.
          role: highestRole(
            rolesOf(user).filter((role) =>
              CRM_TEAM_ROLES.includes(role as UserRole),
            ),
          ) as UserRole,
          roles: rolesOf(user) as UserRole[],
          team: userTeamIds.length > 0 ? toRef(userTeamIds[0]) : null,
          teamIds: userTeamIds,
          teams: userTeamIds.map(toRef),
        };
      }),
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}
