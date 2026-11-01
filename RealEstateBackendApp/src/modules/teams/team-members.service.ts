import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { escapeRegex } from '../../common/utils/regex.util';
import { highestRole, rolesOf } from '../../common/utils/user-roles.util';
import { CrmActorService } from '../crm/common/access/crm-actor.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UserPublicProfile } from '../users/user-public-profile';
import {
  ListTeamMembersQueryDto,
  TeamMemberResponseDto,
} from './dtos/team.dto';
import { Team, TeamDocument } from './schemas/team.schema';
import { TeamsService } from './teams.service';

const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Thành viên của một nhóm (`/teams/:id/members`, tài liệu 09 mục 6). Thành viên = người dùng chưa xóa có nhóm này trong
 * `teamIds` (đúng cách `memberCount` đếm); Quản lý nhóm (`managerIds`) là quan hệ RIÊNG, không bị thêm/gỡ thành viên đụng tới.
 * - Xem: Quản trị (mọi nhóm) hoặc Quản lý của chính nhóm đó (nằm trong `managerIds`).
 * - Thêm/gỡ: chỉ Quản trị (guard ở controller); logic ghi dùng lại `TeamsService.addUserToTeam/removeUserFromTeam`
 *   (transaction, đồng bộ `teamIds`/`teamId`, `customers.teamIds`, audit `USER_TEAM_CHANGED`, tăng `revision` nhóm khi thêm).
 */
@Injectable()
export class TeamMembersService {
  constructor(
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly actors: CrmActorService,
    private readonly teamsService: TeamsService,
  ) {}

  /** Danh sách thành viên (phân trang, tìm theo tên). Quản lý chỉ xem được nhóm mình quản lý (403), nhóm không tồn tại 404. */
  async list(
    jwt: JwtPayload,
    teamId: string,
    query: ListTeamMembersQueryDto,
  ): Promise<{ data: TeamMemberResponseDto[]; meta: PaginationMetaDto }> {
    const actor = await this.actors.resolve(jwt);
    const team = await this.loadTeam(teamId);

    const isAdmin = actor.roles.includes(UserRole.ADMIN);
    if (!isAdmin && !actor.managedTeamIds.some((id) => id.equals(team._id))) {
      throw new ForbiddenException('Bạn không quản lý nhóm này');
    }

    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = {
      teamIds: team._id,
      deletedAt: null,
    };
    if (query.q) filter.displayName = new RegExp(escapeRegex(query.q), 'i');

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('displayName role roles status')
        .collation(VIETNAMESE_COLLATION)
        .sort({ displayName: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    const managerSet = new Set(team.managerIds.map(String));
    return {
      data: users.map((user) =>
        this.toMember(
          { ...user, _id: String(user._id) },
          managerSet.has(String(user._id)),
        ),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Thêm người dùng vào nhóm (idempotent: đã là thành viên thì trả lại bản ghi, không ghi gì). Nhóm không tồn tại hoặc
   * đã tắt hoạt động 404; người dùng không tồn tại 404; không có role MANAGER/STAFF 400 VALIDATION_FAILED.
   */
  async add(
    jwt: JwtPayload,
    teamId: string,
    userId: string,
  ): Promise<TeamMemberResponseDto> {
    const team = await this.loadTeam(teamId);
    const profile = await this.teamsService.addUserToTeam(jwt, userId, teamId);
    return this.toMember(
      profile,
      team.managerIds.some((id) => id.equals(userId)),
    );
  }

  /** Gỡ người dùng khỏi nhóm (idempotent: không thuộc nhóm thì không làm gì). Không đụng `managerIds` của nhóm. */
  async remove(jwt: JwtPayload, teamId: string, userId: string): Promise<void> {
    await this.loadTeam(teamId);
    await this.teamsService.removeUserFromTeam(jwt, userId, teamId);
  }

  private async loadTeam(teamId: string) {
    const team = await this.teamModel
      .findOne({ _id: new Types.ObjectId(teamId), deletedAt: null })
      .select('managerIds')
      .lean()
      .exec();
    if (!team) throw new NotFoundException('Không tìm thấy nhóm');
    return team;
  }

  private toMember(
    user: Pick<UserPublicProfile, '_id' | 'displayName' | 'status'> & {
      role?: string | null;
      roles?: readonly string[] | null;
    },
    isManager: boolean,
  ): TeamMemberResponseDto {
    const roles = rolesOf(user) as UserRole[];
    return {
      id: user._id,
      displayName: user.displayName,
      role: (highestRole(roles) ?? user.role) as UserRole,
      roles,
      status: user.status,
      isManager,
    };
  }
}
