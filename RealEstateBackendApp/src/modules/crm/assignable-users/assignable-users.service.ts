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
import { CrmActor, resolveAssignableTeamIds } from '../common/access/crm-actor';
import { CrmActorService } from '../common/access/crm-actor.service';
import { buildCustomerScope } from '../customers/access/customer-scope';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  AssignableUserResponseDto,
  AssignableUsersPurpose,
  ListAssignableUsersQueryDto,
} from './dtos/assignable-users.dto';

const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Người có thể được phân chăm sóc khách (`GET /crm/assignable-users`, tài liệu 05 mục 2.2).
 * Chỉ người có role MANAGER/STAFF đang hoạt động (khớp lỗi `USER_NOT_ASSIGNABLE`); người nhiều nhóm xuất hiện khi lọc theo
 * bất kỳ nhóm nào của họ. Phạm vi theo người gọi KHỚP đúng luật của `assertAssignable` (`resolveAssignableTeamIds`): chỉ
 * liệt kê người mà thao tác phân chăm sóc sau đó được chấp nhận. Quản trị thấy tất cả; Quản lý thấy người thuộc nhóm mình
 * QUẢN LÝ (không gồm nhóm mình chỉ là thành viên); Nhân viên thấy người cùng nhóm.
 * Chỉ trả id + tên hiển thị + vai trò + nhóm — không lộ email.
 *
 * `purpose=filter` (tài liệu 09 mục 6.10, lọc ≠ gán): nguồn cho ô lọc "Người phụ trách". Với Quản lý là CÁC NGƯỜI XUẤT HIỆN trong
 * `careTeam` của tập khách Quản lý được thấy (đúng `buildCustomerScope`, bỏ khách xóa mềm) — gồm cả người ở nhóm mình chỉ là
 * thành viên, và KHÔNG gồm người ngoài tập đó. Quản trị/Nhân viên giữ hành vi gán. Ô gán người luôn dùng chế độ chặt (mặc định).
 */
@Injectable()
export class AssignableUsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly actors: CrmActorService,
  ) {}

  async list(
    jwt: JwtPayload,
    query: ListAssignableUsersQueryDto,
  ): Promise<{ data: AssignableUserResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const emptyResult = { data: [], meta: buildPaginationMeta(0, page, limit) };

    const actor = await this.actors.resolve(jwt);
    if (
      query.purpose === AssignableUsersPurpose.FILTER &&
      actor.role === UserRole.MANAGER
    ) {
      return this.listFilterOptionsForManager(actor, query);
    }
    const scopeTeamIds = resolveAssignableTeamIds(actor);
    // Vai trò ngoài CRM hoặc không có nhóm nào trong phạm vi phân: không có ai để liệt kê.
    if (scopeTeamIds !== null && scopeTeamIds.length === 0) return emptyResult;

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
      filter.teamIds = requestedTeamId ?? { $in: scopeTeamIds };
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

    return {
      data: await this.toResponses(users),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Nguồn lọc "Người phụ trách" của Quản lý: người xuất hiện trong `careTeam` của tập khách Quản lý được thấy. Dùng
   * `distinct` trên index `careTeam.userId`/`teamIds` (một truy vấn, không N+1), rồi tra user đã xóa mềm bị loại. Không lọc
   * trạng thái/role: khách vẫn có thể gắn với người đã khóa hoặc đã đổi role và Quản lý cần lọc được họ.
   */
  private async listFilterOptionsForManager(
    actor: CrmActor,
    query: ListAssignableUsersQueryDto,
  ): Promise<{ data: AssignableUserResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);

    const userIds = await this.customerModel
      .distinct('careTeam.userId', {
        $and: [buildCustomerScope(actor), { deletedAt: null }],
      })
      .exec();

    const filter: Record<string, unknown> = {
      _id: { $in: userIds },
      deletedAt: null,
    };
    if (query.teamId) filter.teamIds = new Types.ObjectId(query.teamId);
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

    return {
      data: await this.toResponses(users),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Dựng response cho cả lô người dùng bằng một truy vấn gom tên nhóm (không N+1). */
  private async toResponses(
    users: Array<
      Pick<User, 'displayName' | 'role' | 'roles' | 'teamId' | 'teamIds'> & {
        _id: Types.ObjectId;
      }
    >,
  ): Promise<AssignableUserResponseDto[]> {
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

    return users.map((user) => {
      const userTeamIds = teamIdsOf(user);
      const roles = rolesOf(user);
      const toRef = (id: string) => ({
        id,
        label: teamNameById.get(id) ?? '',
      });
      return {
        id: String(user._id),
        displayName: user.displayName,
        // `role` giữ hợp đồng cũ (MANAGER/STAFF): role cao nhất trong các role được phân chăm sóc; chế độ lọc có thể gặp người
        // đã đổi sang role khác thì lấy role cao nhất của họ.
        role: (highestRole(
          roles.filter((role) => CRM_TEAM_ROLES.includes(role as UserRole)),
        ) ?? highestRole(roles)) as UserRole,
        roles: roles as UserRole[],
        team: userTeamIds.length > 0 ? toRef(userTeamIds[0]) : null,
        teamIds: userTeamIds,
        teams: userTeamIds.map(toRef),
      };
    });
  }
}
