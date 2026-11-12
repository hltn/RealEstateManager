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
import { CrmActorService } from '../common/access/crm-actor.service';
import { buildCustomerScope } from './access/customer-scope';
import {
  CustomerAssigneeResponseDto,
  ListCustomerAssigneesQueryDto,
} from './dtos/customer-assignees.dto';
import { Customer, CustomerDocument } from './schemas/customer.schema';

const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Nguồn cho ô lọc "Người phụ trách" (`GET /crm/customer-assignees`, Architecture mục 5.5a, FR-09/FR-18); thay nhánh
 * `purpose=filter` của module danh sách phân chăm sóc cũ (đã xóa), áp cho MỌI vai trò CRM.
 *
 * Tập người = những người xuất hiện trong `careTeam` của các khách mà người gọi được thấy (`buildCustomerScope`, bỏ khách
 * xóa mềm). Không lọc trạng thái/role: khách vẫn gắn với người đã bị khóa hoặc đã đổi role và người dùng cần lọc được họ
 * (kèm `isLocked`). Chỉ trả id, tên, vai trò, nhóm, cờ khóa — không email/SĐT/CCCD.
 */
@Injectable()
export class CustomerAssigneesService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly actors: CrmActorService,
  ) {}

  /**
   * Luồng: (1) dựng actor từ DB (vai trò ngoài CRM ⇒ phạm vi rỗng ⇒ danh sách rỗng); (2) một `distinct` trên
   * `careTeam.userId` theo phạm vi khách; (3) tra user (chưa xóa mềm) lọc `q`/`teamId`, sắp theo tên, phân trang;
   * (4) gom tên nhóm của cả trang bằng ĐÚNG MỘT truy vấn `teams` (không N+1).
   */
  async list(
    jwt: JwtPayload,
    query: ListCustomerAssigneesQueryDto,
  ): Promise<{
    data: CustomerAssigneeResponseDto[];
    meta: PaginationMetaDto;
  }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const actor = await this.actors.resolve(jwt);

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
        .select('displayName role roles status teamId teamIds')
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

  /** Dựng response cho cả trang bằng một truy vấn `teams` duy nhất (nhóm không còn/đã xóa mềm ⇒ nhãn rỗng). */
  private async toResponses(
    users: Array<
      Pick<
        User,
        'displayName' | 'role' | 'roles' | 'status' | 'teamId' | 'teamIds'
      > & { _id: Types.ObjectId }
    >,
  ): Promise<CustomerAssigneeResponseDto[]> {
    const teamIds = [
      ...new Map(
        users
          .flatMap((user) => teamObjectIdsOf(user))
          .map((id) => [String(id), id]),
      ).values(),
    ];
    const teams = teamIds.length
      ? await this.teamModel
          .find({ _id: { $in: teamIds }, deletedAt: null })
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
        // Role cao nhất trong các role được phân chăm sóc; người đã đổi sang role khác thì lấy role cao nhất của họ.
        role: (highestRole(
          roles.filter((role) => CRM_TEAM_ROLES.includes(role as UserRole)),
        ) ?? highestRole(roles)) as UserRole,
        team: userTeamIds.length > 0 ? toRef(userTeamIds[0]) : null,
        teams: userTeamIds.map(toRef),
        isLocked: user.status === UserStatus.BLOCKED,
      };
    });
  }
}
