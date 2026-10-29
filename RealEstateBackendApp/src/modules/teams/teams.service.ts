import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { escapeRegex } from '../../common/utils/regex.util';
import { rolesOf } from '../../common/utils/user-roles.util';
import { withTransaction } from '../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../crm/audit-logs/crm-audit.constants';
import { diffFields } from '../crm/audit-logs/audit-diff.util';
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
import { resolveVisibleTeamIds } from '../crm/common/access/crm-actor';
import { CrmActorService } from '../crm/common/access/crm-actor.service';
import { CustomerTeamSyncService } from '../crm/customers/customer-team-sync.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  teamObjectIdsOf,
  toUserPublicProfile,
  UserPublicProfile,
} from '../users/user-public-profile';
import {
  CreateTeamDto,
  ListTeamsQueryDto,
  TeamResponseDto,
  UpdateTeamDto,
} from './dtos/team.dto';
import { Team, TeamDocument } from './schemas/team.schema';
import {
  assertRolesCanJoinTeam,
  lockActiveTeams,
  sameIdList,
  uniqueObjectIds,
} from './team-membership.util';

const TEAM_AUDIT_FIELDS = ['name', 'managerIds', 'isActive'] as const;
const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

/**
 * Nhóm làm việc (CRUD, tài liệu 05 mục 2.2). Quản trị ghi; Quản lý chỉ đọc nhóm mình.
 * Mọi thay đổi ghi audit trong cùng transaction.
 */
@Injectable()
export class TeamsService {
  constructor(
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly actors: CrmActorService,
    private readonly audit: CrmAuditLogService,
    private readonly teamSync: CustomerTeamSyncService,
  ) {}

  /** Danh sách nhóm: ADMIN thấy tất cả; MANAGER chỉ nhóm mình quản lý hoặc thuộc về. */
  async list(
    jwt: JwtPayload,
    query: ListTeamsQueryDto,
  ): Promise<{ data: TeamResponseDto[]; meta: PaginationMetaDto }> {
    const actor = await this.actors.resolve(jwt);
    const visibleTeamIds = resolveVisibleTeamIds(actor);
    const { page, limit, skip } = normalizePagination(query.page, query.limit);

    const filter: Record<string, unknown> = { deletedAt: null };
    if (visibleTeamIds !== null) filter._id = { $in: visibleTeamIds };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: pattern }, { code: pattern }];
    }

    const [teams, total] = await Promise.all([
      this.teamModel
        .find(filter)
        .collation(VIETNAMESE_COLLATION)
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.teamModel.countDocuments(filter).exec(),
    ]);

    return {
      data: await this.toResponses(teams),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Tạo nhóm; mã trùng (kể cả nhóm đã xóa mềm) => 409 TEAM_CODE_DUPLICATED. */
  async create(jwt: JwtPayload, dto: CreateTeamDto): Promise<TeamResponseDto> {
    const managerIds = await this.assertManagers(dto.managerIds ?? []);
    const actorId = new Types.ObjectId(jwt.sub);

    const team = await this.runCatchingDuplicate(dto.code, () =>
      withTransaction(this.connection, async (session) => {
        const [created] = await this.teamModel.create(
          [
            {
              name: dto.name,
              code: dto.code,
              managerIds,
              isActive: true,
              createdBy: actorId,
              updatedBy: actorId,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.TEAM,
            entityId: created._id,
            action: CrmAuditAction.TEAM_CREATED,
            actor: jwt,
            changes: diffFields({}, created.toObject(), [
              'name',
              'code',
              'managerIds',
              'isActive',
            ]),
          },
          session,
        );
        return created.toObject();
      }),
    );

    return (await this.toResponses([team]))[0];
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    const managerIds =
      dto.managerIds === undefined
        ? undefined
        : await this.assertManagers(dto.managerIds);

    const updated = await withTransaction(this.connection, async (session) => {
      const before = await this.teamModel
        .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!before) throw this.notFound();

      const patch: Record<string, unknown> = {
        updatedBy: new Types.ObjectId(jwt.sub),
      };
      if (dto.name !== undefined) patch.name = dto.name;
      if (managerIds !== undefined) patch.managerIds = managerIds;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const after = await this.teamModel
        .findOneAndUpdate(
          { _id: before._id },
          { $set: patch },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw this.notFound();

      const changes = diffFields(before, after, TEAM_AUDIT_FIELDS);
      if (changes.length > 0) {
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.TEAM,
            entityId: before._id,
            action: CrmAuditAction.TEAM_UPDATED,
            actor: jwt,
            changes,
          },
          session,
        );
      }
      return after;
    });

    return (await this.toResponses([updated]))[0];
  }

  /** Xóa mềm; còn thành viên => 409 TEAM_NOT_EMPTY { memberCount }. */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    await withTransaction(this.connection, async (session) => {
      const teamId = new Types.ObjectId(id);
      const team = await this.teamModel
        .findOne({ _id: teamId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!team) throw this.notFound();

      // `teamId` (nhóm chính) kiểm thêm để tài khoản chưa migrate sang `teamIds` vẫn chặn được việc xóa nhóm.
      const memberCount = await this.userModel
        .countDocuments({
          $or: [{ teamIds: teamId }, { teamId }],
          deletedAt: null,
        })
        .session(session)
        .exec();
      if (memberCount > 0) {
        throw new BusinessException(
          ErrorCode.TEAM_NOT_EMPTY,
          'Nhóm còn thành viên, hãy chuyển họ sang nhóm khác trước khi xóa',
          HttpStatus.CONFLICT,
          { memberCount },
        );
      }

      await this.teamModel
        .updateOne(
          { _id: teamId },
          {
            $set: {
              deletedAt: new Date(),
              updatedBy: new Types.ObjectId(jwt.sub),
            },
          },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.TEAM,
          entityId: teamId,
          action: CrmAuditAction.TEAM_DELETED,
          actor: jwt,
          changes: [{ field: 'name', from: team.name, to: null }],
        },
        session,
      );
    });
  }

  /**
   * Gán người dùng vào MỘT nhóm (hoặc gỡ khỏi mọi nhóm khi `teamId = null`) — `PATCH /users/:id/team`
   * (hợp đồng cũ của frontend): đặt `teamIds = [teamId]` hoặc `[]`. Xem `updateUserTeams`.
   */
  assignUserToTeam(
    jwt: JwtPayload,
    userId: string,
    teamId: string | null,
  ): Promise<UserPublicProfile> {
    return this.updateUserTeams(jwt, userId, teamId === null ? [] : [teamId]);
  }

  /** Đặt toàn bộ nhóm của người dùng — `PATCH /users/:id/teams`. Chạy trong transaction riêng (xem `setUserTeams`). */
  async updateUserTeams(
    jwt: JwtPayload,
    userId: string,
    teamIds: string[],
  ): Promise<UserPublicProfile> {
    const updated = await withTransaction(this.connection, (session) =>
      this.setUserTeams(
        new Types.ObjectId(userId),
        teamIds.map((id) => new Types.ObjectId(id)),
        jwt,
        session,
      ),
    );
    return toUserPublicProfile(updated);
  }

  /** Thêm người dùng vào một nhóm (giữ nguyên các nhóm khác; nhóm mới nằm cuối, không đổi nhóm chính). Đã thuộc nhóm ⇒ no-op. */
  async addUserToTeam(
    actor: Pick<JwtPayload, 'sub'>,
    userId: string,
    teamId: string,
  ): Promise<UserPublicProfile> {
    const userObjectId = new Types.ObjectId(userId);
    const updated = await withTransaction(this.connection, async (session) => {
      const user = await this.loadUser(userObjectId, session);
      return this.setUserTeams(
        userObjectId,
        [...teamObjectIdsOf(user), new Types.ObjectId(teamId)],
        actor,
        session,
      );
    });
    return toUserPublicProfile(updated);
  }

  /** Gỡ người dùng khỏi một nhóm (giữ các nhóm khác). Không thuộc nhóm đó ⇒ no-op. */
  async removeUserFromTeam(
    actor: Pick<JwtPayload, 'sub'>,
    userId: string,
    teamId: string,
  ): Promise<UserPublicProfile> {
    const userObjectId = new Types.ObjectId(userId);
    const teamObjectId = new Types.ObjectId(teamId);
    const updated = await withTransaction(this.connection, async (session) => {
      const user = await this.loadUser(userObjectId, session);
      return this.setUserTeams(
        userObjectId,
        teamObjectIdsOf(user).filter((id) => !id.equals(teamObjectId)),
        actor,
        session,
      );
    });
    return toUserPublicProfile(updated);
  }

  /**
   * Đặt toàn bộ nhóm của người dùng TRONG transaction của caller (dùng chung cho `PATCH /users/:id/team(s)` và
   * thêm/gỡ thành viên nhóm).
   * - Có nhóm thì người dùng phải có role MANAGER/STAFF (400); mỗi nhóm MỚI THÊM phải tồn tại và đang hoạt động (404)
   *   và bị "khóa ghi" (tăng `revision`). Nhóm giữ nguyên không bị kiểm lại (nhóm đã bị vô hiệu hóa vẫn gỡ được).
   * - Thứ tự quyết định nhóm chính: `teamId = teamIds[0] ?? null` (trường suy ra, luôn ghi cùng `teamIds`).
   * - Danh sách không đổi ⇒ no-op (không ghi, không audit).
   * - Ghi audit USER_TEAM_CHANGED và tính lại `customers.teamIds` (phạm vi Quản lý) NGAY trong cùng transaction.
   */
  async setUserTeams(
    userId: Types.ObjectId,
    teamIds: Types.ObjectId[],
    actor: Pick<JwtPayload, 'sub'>,
    session: ClientSession,
  ) {
    const user = await this.loadUser(userId, session);
    const before = teamObjectIdsOf(user);
    const next = uniqueObjectIds(teamIds);
    if (sameIdList(before, next)) return user;

    if (next.length > 0) assertRolesCanJoinTeam(rolesOf(user));
    const added = next.filter(
      (id) => !before.some((existing) => existing.equals(id)),
    );
    await lockActiveTeams(this.teamModel, added, session);

    const after = await this.userModel
      .findOneAndUpdate(
        { _id: userId },
        { $set: { teamIds: next, teamId: next[0] ?? null } },
        { returnDocument: 'after', session },
      )
      .lean()
      .exec();
    if (!after) throw new NotFoundException('User not found');

    await this.audit.record(
      {
        entityType: CrmAuditEntityType.USER,
        entityId: userId,
        action: CrmAuditAction.USER_TEAM_CHANGED,
        actor,
        changes: diffFields({ teamIds: before }, { teamIds: next }, [
          'teamIds',
        ]),
      },
      session,
    );
    await this.teamSync.syncForUser(userId, session);
    return after;
  }

  private async loadUser(userId: Types.ObjectId, session: ClientSession) {
    const user = await this.userModel
      .findOne({ _id: userId, deletedAt: null })
      .session(session)
      .lean()
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Người quản lý nhóm phải là MANAGER đang hoạt động, chưa xóa. Trả danh sách ObjectId đã khử trùng. */
  private async assertManagers(
    managerIds: string[],
  ): Promise<Types.ObjectId[]> {
    const ids = [...new Set(managerIds)].map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return [];

    const valid = await this.userModel
      .find({
        _id: { $in: ids },
        deletedAt: null,
        status: UserStatus.ACTIVE,
        roles: UserRole.MANAGER,
      })
      .select('_id')
      .lean()
      .exec();
    const validSet = new Set(valid.map((user) => String(user._id)));
    const invalid = ids.filter((id) => !validSet.has(String(id)));
    if (invalid.length > 0) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Quản lý nhóm phải là người dùng vai trò Quản lý đang hoạt động',
        HttpStatus.BAD_REQUEST,
        { userIds: invalid.map(String) },
      );
    }
    return ids;
  }

  /** Dựng response cho cả lô nhóm bằng 2 truy vấn gom (người quản lý, số thành viên) — không N+1. */
  private async toResponses(
    teams: Array<
      Pick<Team, 'name' | 'code' | 'managerIds' | 'isActive'> & {
        _id: Types.ObjectId;
      }
    >,
  ): Promise<TeamResponseDto[]> {
    if (teams.length === 0) return [];
    const teamIds = teams.map((team) => team._id);
    const managerIds = [
      ...new Set(teams.flatMap((team) => team.managerIds.map(String))),
    ].map((id) => new Types.ObjectId(id));

    const [managers, counts] = await Promise.all([
      this.userModel
        .find({ _id: { $in: managerIds }, deletedAt: null })
        .select('displayName')
        .lean()
        .exec(),
      this.userModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          // Một người nhiều nhóm được đếm ở từng nhóm của họ.
          { $match: { teamIds: { $in: teamIds }, deletedAt: null } },
          { $unwind: '$teamIds' },
          { $match: { teamIds: { $in: teamIds } } },
          { $group: { _id: '$teamIds', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const managerById = new Map(
      managers.map((user) => [String(user._id), user.displayName]),
    );
    const countByTeam = new Map(
      counts.map((row) => [String(row._id), row.count]),
    );

    return teams.map((team) => ({
      id: String(team._id),
      name: team.name,
      code: team.code,
      managers: team.managerIds
        .filter((managerId) => managerById.has(String(managerId)))
        .map((managerId) => ({
          id: String(managerId),
          displayName: managerById.get(String(managerId)) as string,
        })),
      memberCount: countByTeam.get(String(team._id)) ?? 0,
      isActive: team.isActive,
    }));
  }

  /** Chuyển lỗi unique index (race tạo cùng mã) thành 409 nghiệp vụ. */
  private async runCatchingDuplicate<T>(
    code: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BusinessException(
          ErrorCode.TEAM_CODE_DUPLICATED,
          `Mã nhóm "${code}" đã tồn tại`,
          HttpStatus.CONFLICT,
          { code },
        );
      }
      throw error;
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Không tìm thấy nhóm');
  }
}
