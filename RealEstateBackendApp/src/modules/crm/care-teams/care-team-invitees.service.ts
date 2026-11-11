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
import { teamObjectIdsOf } from '../../users/user-public-profile';
import { CrmActorService } from '../common/access/crm-actor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { buildCustomerScope } from '../customers/access/customer-scope';
import { customerNotFound } from '../customers/customer.errors';
import { CustomersRepository } from '../customers/customers.repository';
import { canManageMembers, careTeamActionForbidden } from './care-team.rules';
import {
  CareTeamInviteeResponseDto,
  ListCareTeamInviteesQueryDto,
} from './dtos/care-team-invitees.dto';

const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Danh sách người có thể được mời vào nhóm chăm sóc (`GET /crm/care-team-invitees`, Architecture mục 4, FR-13/FR-14);
 * thay phần "mời/gán" của `assignable-users` đã bị xóa. Toàn hệ thống, KHÔNG giới hạn theo nhóm của người gọi.
 *
 * Quyền: Quản trị/Quản lý, hoặc phụ trách chính (PRIMARY) của khách `customerId`. Không có `customerId` (thao tác hàng
 * loạt) chỉ Quản trị/Quản lý. Chỉ trả `id`, `displayName`, `teamNames` — không email/SĐT/CCCD/vai trò/id nhóm.
 */
@Injectable()
export class CareTeamInviteesService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    private readonly actors: CrmActorService,
    private readonly customers: CustomersRepository,
    private readonly rateLimit: CrmRateLimitService,
  ) {}

  /**
   * Luồng: (1) rate-limit `INVITEE_SEARCH` (60/phút/người; Redis lỗi ⇒ 503) trước mọi truy vấn DB; (2) dựng actor từ
   * DB; (3) kiểm quyền (có `customerId` ⇒ 404 nếu khách ngoài phạm vi/không tồn tại, 403 nếu không phải
   * Admin/Manager/PRIMARY); (4) lọc user ACTIVE, chưa xóa mềm, role Manager/Staff, trừ người gọi và người đã trong nhóm;
   * (5) gom tên nhóm của cả trang bằng ĐÚNG MỘT truy vấn `teams` (không N+1).
   */
  async list(
    jwt: JwtPayload,
    query: ListCareTeamInviteesQueryDto,
  ): Promise<{
    data: CareTeamInviteeResponseDto[];
    meta: PaginationMetaDto;
  }> {
    await this.rateLimit.consume(jwt.sub, 'INVITEE_SEARCH');
    const actor = await this.actors.resolve(jwt);
    const { page, limit, skip } = normalizePagination(query.page, query.limit);

    const excludedIds: Types.ObjectId[] = [actor.userId];
    if (query.customerId) {
      const customer = await this.customers.findOne(
        buildCustomerScope(actor),
        query.customerId,
        { projection: { careTeam: 1 } },
      );
      if (!customer) throw customerNotFound();
      const careTeam = customer.careTeam ?? [];
      if (!canManageMembers(actor, careTeam)) {
        throw careTeamActionForbidden(
          'Chỉ Quản trị, Quản lý hoặc phụ trách chính được xem danh sách người có thể mời',
        );
      }
      excludedIds.push(...careTeam.map((member) => member.userId));
    } else if (!canManageMembers(actor, [])) {
      throw careTeamActionForbidden(
        'Chỉ Quản trị hoặc Quản lý được xem danh sách người có thể mời khi không chỉ định khách',
      );
    }

    const filter: Record<string, unknown> = {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      roles: { $in: CRM_TEAM_ROLES },
      _id: { $nin: excludedIds },
    };
    if (query.q) filter.displayName = new RegExp(escapeRegex(query.q), 'i');

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('displayName teamId teamIds')
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

  /** Dựng response cho cả trang bằng một truy vấn `teams` duy nhất (nhóm không còn tồn tại bị bỏ qua). */
  private async toResponses(
    users: Array<
      Pick<User, 'displayName' | 'teamId' | 'teamIds'> & {
        _id: Types.ObjectId;
      }
    >,
  ): Promise<CareTeamInviteeResponseDto[]> {
    const teamIdsByUser = users.map((user) => teamObjectIdsOf(user));
    const uniqueTeamIds = [
      ...new Map(teamIdsByUser.flat().map((id) => [String(id), id])).values(),
    ];
    const teams = uniqueTeamIds.length
      ? await this.teamModel
          .find({ _id: { $in: uniqueTeamIds } })
          .select('name')
          .lean()
          .exec()
      : [];
    const nameById = new Map(
      teams.map((team) => [String(team._id), team.name]),
    );

    return users.map((user, index) => ({
      id: String(user._id),
      displayName: user.displayName,
      teamNames: teamIdsByUser[index]
        .map((id) => nameById.get(String(id)))
        .filter((name): name is string => Boolean(name)),
    }));
  }
}
