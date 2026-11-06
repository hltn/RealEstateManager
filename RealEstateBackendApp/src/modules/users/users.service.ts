import {
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import { User, UserDocument } from './schemas/user.schema';
import { Team, TeamDocument } from '../teams/schemas/team.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from '../auth/schemas/refresh-token.schema';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  hasCrmTeamRole,
  highestRole,
  normalizeRoles,
  rolesOf,
} from '../../common/utils/user-roles.util';
import { UserStatus } from '../../common/enums/user-status.enum';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { escapeRegex } from '../../common/utils/regex.util';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { PushRevokedReason } from '../notifications/push/push-subscription.constants';
import { PushSubscriptionManagementService } from '../notifications/push/push-subscription-management.service';
import { withTransaction } from '../../shared/database/with-transaction.util';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { diffFields } from '../crm/audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../crm/audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
import { CustomerTeamSyncService } from '../crm/customers/customer-team-sync.service';
import {
  assertRolesCanJoinTeam,
  lockActiveTeams,
  uniqueObjectIds,
} from '../teams/team-membership.util';
import {
  teamIdsOf,
  toUserPublicProfile,
  UserPublicProfile,
} from './user-public-profile';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserStatusDto } from './dtos/update-user-status.dto';
import { UpdateUserRoleDto } from './dtos/update-user-role.dto';
import { UpdateUserRolesDto } from './dtos/update-user-roles.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { ResetUserPasswordDto } from './dtos/reset-user-password.dto';

/** Bộ lọc tùy chọn của danh sách tài khoản (tài liệu 05 mục 2.2). */
export interface UserListFilters {
  role?: UserRole;
  teamId?: string;
  status?: UserStatus;
  q?: string;
}

const EMAIL_IN_USE_MESSAGE = 'Email already in use';

/**
 * UsersService — CRUD tài khoản (ADMIN only).
 * Mọi query đều filter `deletedAt: null` (soft delete).
 * Password luôn hash argon2, KHÔNG trả ra API.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: CrmAuditLogService,
    private readonly teamSync: CustomerTeamSyncService,
    private readonly pushSubscriptions: PushSubscriptionManagementService,
  ) {}

  /**
   * Dựng filter Mongo từ bộ lọc (chỉ các khóa có giá trị); `q` tìm theo tên hiển thị hoặc email, đã escape regex.
   * `role` khớp tài khoản CÓ role đó trong `roles`; `teamId` khớp tài khoản CÓ nhóm đó trong `teamIds`.
   */
  private buildListFilter(filters: UserListFilters): Record<string, unknown> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (filters.role) filter.roles = filters.role;
    if (filters.status) filter.status = filters.status;
    if (filters.teamId) filter.teamIds = new Types.ObjectId(filters.teamId);
    if (filters.q) {
      const pattern = new RegExp(escapeRegex(filters.q), 'i');
      filter.$or = [{ displayName: pattern }, { email: pattern }];
    }
    return filter;
  }

  /** Lấy danh sách user phân trang (có thể lọc theo vai trò, nhóm, trạng thái, từ khóa). */
  async findAll(page = 1, limit = 20, filters: UserListFilters = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    const filter = this.buildListFilter(filters);

    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((d) => toUserPublicProfile(d)),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  /**
   * Tạo user mới. Email trùng (chưa soft delete) → 409 Conflict.
   * `roles` (hoặc `role` đơn = `[role]`) và `teamIds` (hoặc `teamId` đơn = `[teamId]`); `role`/`teamId` suy ra từ đó.
   * Gửi cả hai dạng mà mâu thuẫn (role khác role cao nhất của roles, teamId khác teamIds[0]) → 400.
   */
  async create(dto: CreateUserDto): Promise<UserPublicProfile> {
    const roles = normalizeRoles(dto.roles ?? (dto.role ? [dto.role] : []));
    if (roles.length === 0) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Cần ít nhất một vai trò',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Gửi cả dạng viết tắt lẫn dạng đầy đủ thì hai bên phải nhất quán, không âm thầm chọn một bên.
    if (dto.roles !== undefined && dto.role !== undefined) {
      const highest = highestRole(roles);
      if (dto.role !== highest) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          `role (${String(dto.role)}) không khớp roles: role phải là role cao nhất trong roles (${String(highest)}), hoặc chỉ gửi roles`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const teamIds = uniqueObjectIds(
      (dto.teamIds ?? (dto.teamId ? [dto.teamId] : [])).map(
        (id) => new Types.ObjectId(id),
      ),
    );
    if (dto.teamIds !== undefined && dto.teamId !== undefined) {
      const primaryTeamId = teamIds[0] ? String(teamIds[0]) : null;
      if (String(new Types.ObjectId(dto.teamId)) !== primaryTeamId) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          `teamId không khớp teamIds: teamId phải là phần tử đầu của teamIds (${primaryTeamId ?? 'rỗng'}), hoặc chỉ gửi teamIds`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const exists = await this.userModel
      .findOne({ email: dto.email.toLowerCase(), deletedAt: null })
      .lean()
      .exec();
    if (exists) {
      throw new ConflictException(EMAIL_IN_USE_MESSAGE);
    }

    const passwordHash = await argon2.hash(dto.password);
    const newUser = {
      email: dto.email.toLowerCase(),
      password: passwordHash,
      displayName: dto.displayName,
      role: highestRole(roles) as UserRole,
      roles,
      teamId: null as Types.ObjectId | null,
      teamIds: [] as Types.ObjectId[],
      status: UserStatus.ACTIVE,
      deletedAt: null,
      lastLoginAt: null,
    };

    // Hai POST đồng thời cùng email cùng qua kiểm trước: chỉ unique index {email, deletedAt} bắt được (E11000 → 409).
    try {
      if (teamIds.length === 0) {
        return toUserPublicProfile(await this.userModel.create(newUser));
      }

      // Có nhóm: kiểm nhóm + "khóa ghi" nhóm + tạo user trong CÙNG transaction để việc xóa nhóm đồng thời
      // không để lại tài khoản mới trỏ vào nhóm đã xóa (xem TeamsService.setUserTeams).
      assertRolesCanJoinTeam(roles);
      const created = await withTransaction(
        this.connection,
        async (session) => {
          await lockActiveTeams(this.teamModel, teamIds, session);
          const [doc] = await this.userModel.create(
            [{ ...newUser, teamId: teamIds[0], teamIds }],
            { session },
          );
          return doc;
        },
      );
      return toUserPublicProfile(created);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(EMAIL_IN_USE_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Hệ thống phải luôn còn ít nhất một ADMIN đang hoạt động: chặn khóa/hạ vai trò ADMIN cuối cùng (409).
   * Sau khi kiểm, "chạm" mọi ADMIN đang hoạt động để hai lần khóa/hạ vai trò chéo nhau (A khóa B, B khóa A)
   * xung đột ghi và buộc một bên retry — tránh write-skew để lại 0 ADMIN.
   */
  private async assertAnotherActiveAdmin(
    userId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const others = await this.userModel
      .countDocuments({
        _id: { $ne: userId },
        roles: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      })
      .session(session)
      .exec();
    if (others === 0) {
      throw new BusinessException(
        ErrorCode.LAST_ADMIN_REQUIRED,
        'Hệ thống phải còn ít nhất một Quản trị đang hoạt động, không thể khóa hoặc hạ vai trò Quản trị cuối cùng',
        HttpStatus.CONFLICT,
      );
    }
    await this.userModel
      .updateMany(
        { roles: UserRole.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
        { $currentDate: { updatedAt: true } },
        { session, timestamps: false },
      )
      .exec();
  }

  /**
   * Thu hồi mọi refresh token còn hiệu lực của tài khoản (đăng xuất mọi thiết bị) — cùng cách đánh dấu
   * `isRevoked` như AuthService.revokeFamily/logout. Chạy trong transaction của thao tác gọi nó.
   * Access token đã cấp vẫn dùng được tới khi hết hạn (guard JWT không tra DB); sau đó không refresh được nữa.
   */
  private async revokeAllSessions(
    userId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.refreshTokenModel
      .updateMany(
        { userId, isRevoked: false },
        { $set: { isRevoked: true } },
        { session },
      )
      .exec();
  }

  /**
   * Admin sửa tên hiển thị và/hoặc email + audit USER_UPDATED cùng transaction.
   *
   * - Cần ít nhất một trường (400). Email chuẩn hóa chữ thường; trùng tài khoản khác chưa xóa → 409.
   * - Giá trị không đổi so với hiện tại là no-op (không ghi, không audit).
   * - Email đổi thật thì thu hồi mọi refresh token của tài khoản: phải đăng nhập lại bằng email mới
   *   (email nằm trong payload access token nên không để phiên cũ gia hạn mãi với email cũ).
   */
  async updateProfile(
    id: string,
    dto: UpdateUserDto,
    actor: Pick<JwtPayload, 'sub'>,
  ): Promise<UserPublicProfile> {
    const displayName = dto.displayName ?? undefined;
    const email = dto.email?.toLowerCase();
    if (displayName === undefined && email === undefined) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Cần ít nhất một trường để cập nhật: displayName hoặc email',
        HttpStatus.BAD_REQUEST,
      );
    }

    const userId = new Types.ObjectId(id);
    try {
      const doc = await withTransaction(this.connection, async (session) => {
        const before = await this.userModel
          .findOne({ _id: userId, deletedAt: null })
          .session(session)
          .lean()
          .exec();
        if (!before) throw new NotFoundException('User not found');

        const changes: Record<string, string> = {};
        if (displayName !== undefined && displayName !== before.displayName) {
          changes.displayName = displayName;
        }
        if (email !== undefined && email !== before.email) {
          const taken = await this.userModel
            .exists({ _id: { $ne: userId }, email, deletedAt: null })
            .session(session)
            .exec();
          if (taken) throw new ConflictException(EMAIL_IN_USE_MESSAGE);
          changes.email = email;
        }
        if (Object.keys(changes).length === 0) return before;

        const after = await this.userModel
          .findOneAndUpdate(
            { _id: userId },
            { $set: changes },
            { returnDocument: 'after', session },
          )
          .lean()
          .exec();
        if (!after) throw new NotFoundException('User not found');

        if (changes.email) await this.revokeAllSessions(userId, session);

        await this.audit.record(
          {
            entityType: CrmAuditEntityType.USER,
            entityId: userId,
            action: CrmAuditAction.USER_UPDATED,
            actor,
            changes: diffFields(before, after, ['displayName', 'email']),
          },
          session,
        );
        return after;
      });
      return toUserPublicProfile(doc);
    } catch (error) {
      // Hai request đổi email đồng thời: chỉ unique index {email, deletedAt} bắt được.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(EMAIL_IN_USE_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Admin đặt lại mật khẩu (của mình hoặc người khác) + thu hồi mọi refresh token + audit USER_PASSWORD_RESET
   * cùng transaction. Hash argon2 làm TRƯỚC transaction (tốn CPU, và transaction có thể tự retry).
   * Audit chỉ ghi sự kiện, `changes` rỗng — tuyệt đối không ghi mật khẩu/hash.
   */
  async resetPassword(
    id: string,
    dto: ResetUserPasswordDto,
    actor: Pick<JwtPayload, 'sub'>,
  ): Promise<UserPublicProfile> {
    const userId = new Types.ObjectId(id);
    const passwordHash = await argon2.hash(dto.newPassword);
    const doc = await withTransaction(this.connection, async (session) => {
      const after = await this.userModel
        .findOneAndUpdate(
          { _id: userId, deletedAt: null },
          { $set: { password: passwordHash } },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw new NotFoundException('User not found');

      await this.revokeAllSessions(userId, session);
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.USER,
          entityId: userId,
          action: CrmAuditAction.USER_PASSWORD_RESET,
          actor,
        },
        session,
      );
      return after;
    });
    return toUserPublicProfile(doc);
  }

  private isActiveAdmin(user: {
    role: UserRole;
    roles?: UserRole[];
    status: UserStatus;
  }): boolean {
    return (
      rolesOf(user).includes(UserRole.ADMIN) &&
      user.status === UserStatus.ACTIVE
    );
  }

  /**
   * Cập nhật trạng thái (block/unblock) + audit USER_STATUS_CHANGED cùng transaction.
   * Không cho khóa ADMIN đang hoạt động cuối cùng (409 LAST_ADMIN_REQUIRED). Đặt lại đúng trạng thái hiện có là no-op.
   */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: Pick<JwtPayload, 'sub'>,
  ): Promise<UserPublicProfile> {
    const userId = new Types.ObjectId(id);
    const doc = await withTransaction(this.connection, async (session) => {
      const before = await this.userModel
        .findOne({ _id: userId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!before) throw new NotFoundException('User not found');
      if (before.status === dto.status) return before;

      if (dto.status === UserStatus.BLOCKED && this.isActiveAdmin(before)) {
        await this.assertAnotherActiveAdmin(userId, session);
      }
      const after = await this.userModel
        .findOneAndUpdate(
          { _id: userId },
          { $set: { status: dto.status } },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw new NotFoundException('User not found');

      // Khóa tài khoản: thu hồi mọi thiết bị push cùng transaction (không gửi thêm push sau khi khóa).
      if (dto.status !== UserStatus.ACTIVE) {
        await this.pushSubscriptions.revokeAllForUser(
          userId,
          PushRevokedReason.ACCOUNT_DISABLED,
          session,
        );
      }

      await this.audit.record(
        {
          entityType: CrmAuditEntityType.USER,
          entityId: userId,
          action: CrmAuditAction.USER_STATUS_CHANGED,
          actor,
          changes: diffFields(before, after, ['status']),
        },
        session,
      );
      return after;
    });
    return toUserPublicProfile(doc);
  }

  /**
   * `PATCH /users/:id/role` (hợp đồng cũ của frontend): đặt `roles = [role]` — thay toàn bộ role bằng đúng một role.
   * Xem `updateRoles`.
   */
  updateRole(
    id: string,
    dto: UpdateUserRoleDto,
    actor: Pick<JwtPayload, 'sub'>,
  ): Promise<UserPublicProfile> {
    return this.updateRoles(id, { roles: [dto.role] }, actor);
  }

  /**
   * Đặt toàn bộ role (`PATCH /users/:id/roles`) + audit USER_ROLE_CHANGED (roles/teamIds cũ → mới) cùng transaction.
   *
   * - `roles` được khử trùng; `role` (cao nhất) ghi cùng `roles` trong một lần cập nhật.
   * - Không cho bỏ role ADMIN của ADMIN đang hoạt động cuối cùng (409 LAST_ADMIN_REQUIRED).
   * - Không còn role MANAGER thì gỡ người này khỏi `teams.managerIds`; không còn role MANAGER/STAFF thì xóa luôn
   *   `teamIds`/`teamId` — để không còn "Quản lý ma" giữ quyền theo nhóm sau khi bị hạ vai trò.
   * - Đặt lại đúng tập role hiện có là no-op (không audit).
   */
  async updateRoles(
    id: string,
    dto: UpdateUserRolesDto,
    actor: Pick<JwtPayload, 'sub'>,
  ): Promise<UserPublicProfile> {
    const roles = normalizeRoles(dto.roles);
    const primaryRole = highestRole(roles);
    if (!primaryRole) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Cần ít nhất một vai trò hợp lệ',
        HttpStatus.BAD_REQUEST,
      );
    }

    const userId = new Types.ObjectId(id);
    const doc = await withTransaction(this.connection, async (session) => {
      const before = await this.userModel
        .findOne({ _id: userId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!before) throw new NotFoundException('User not found');
      const rolesBefore = normalizeRoles(rolesOf(before));
      if (
        rolesBefore.length === roles.length &&
        rolesBefore.every((role, index) => role === roles[index])
      ) {
        return before;
      }

      if (!roles.includes(UserRole.ADMIN) && this.isActiveAdmin(before)) {
        await this.assertAnotherActiveAdmin(userId, session);
      }

      const update: Record<string, unknown> = { roles, role: primaryRole };
      if (!hasCrmTeamRole(roles)) {
        update.teamIds = [];
        update.teamId = null;
      }
      const after = await this.userModel
        .findOneAndUpdate(
          { _id: userId },
          { $set: update },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw new NotFoundException('User not found');

      if (!roles.includes(UserRole.MANAGER)) {
        await this.teamModel
          .updateMany(
            { managerIds: userId },
            { $pull: { managerIds: userId } },
            { session },
          )
          .exec();
      }

      // Mất nhóm do đổi vai trò (không còn MANAGER/STAFF) cũng đổi phạm vi khách của Quản lý.
      const teamsBefore = teamIdsOf(before);
      const teamsAfter = teamIdsOf(after);
      if (teamsBefore.join() !== teamsAfter.join()) {
        await this.teamSync.syncForUser(userId, session);
      }

      await this.audit.record(
        {
          entityType: CrmAuditEntityType.USER,
          entityId: userId,
          action: CrmAuditAction.USER_ROLE_CHANGED,
          actor,
          changes: diffFields(
            { roles: rolesBefore, teamIds: teamsBefore },
            { roles: rolesOf(after), teamIds: teamsAfter },
            ['roles', 'teamIds'],
          ),
        },
        session,
      );
      return after;
    });
    return toUserPublicProfile(doc);
  }
}
