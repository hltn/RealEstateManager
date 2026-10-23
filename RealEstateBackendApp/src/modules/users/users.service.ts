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
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { escapeRegex } from '../../common/utils/regex.util';
import { withTransaction } from '../../shared/database/with-transaction.util';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { diffFields } from '../crm/audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../crm/audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
import { CustomerTeamSyncService } from '../crm/customers/customer-team-sync.service';
import { toUserPublicProfile, UserPublicProfile } from './user-public-profile';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserStatusDto } from './dtos/update-user-status.dto';
import { UpdateUserRoleDto } from './dtos/update-user-role.dto';

/** Bộ lọc tùy chọn của danh sách tài khoản (tài liệu 05 mục 2.2). */
export interface UserListFilters {
  role?: UserRole;
  teamId?: string;
  status?: UserStatus;
  q?: string;
}

/** Vai trò mà tài khoản được thuộc một nhóm; vai trò khác bị gỡ khỏi nhóm khi đổi sang. */
const TEAM_MEMBER_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.STAFF,
];

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
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: CrmAuditLogService,
    private readonly teamSync: CustomerTeamSyncService,
  ) {}

  /** Dựng filter Mongo từ bộ lọc (chỉ các khóa có giá trị); `q` tìm theo tên hiển thị hoặc email, đã escape regex. */
  private buildListFilter(filters: UserListFilters): Record<string, unknown> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (filters.role) filter.role = filters.role;
    if (filters.status) filter.status = filters.status;
    if (filters.teamId) filter.teamId = new Types.ObjectId(filters.teamId);
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

  /** Tạo user mới. Email trùng (chưa soft delete) → 409 Conflict. */
  async create(dto: CreateUserDto): Promise<UserPublicProfile> {
    const exists = await this.userModel
      .findOne({ email: dto.email.toLowerCase(), deletedAt: null })
      .lean()
      .exec();
    if (exists) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await argon2.hash(dto.password);
    const newUser = {
      email: dto.email.toLowerCase(),
      password: passwordHash,
      displayName: dto.displayName,
      role: dto.role,
      teamId: null as Types.ObjectId | null,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      lastLoginAt: null,
    };

    if (!dto.teamId) {
      return toUserPublicProfile(await this.userModel.create(newUser));
    }

    // Có nhóm: kiểm nhóm + "khóa ghi" nhóm + tạo user trong CÙNG transaction để việc xóa nhóm đồng thời
    // không để lại tài khoản mới trỏ vào nhóm đã xóa (xem TeamsService.assignUserToTeam).
    this.assertRoleCanJoinTeam(dto.role);
    const teamId = new Types.ObjectId(dto.teamId);
    const created = await withTransaction(this.connection, async (session) => {
      const team = await this.teamModel
        .exists({ _id: teamId, deletedAt: null, isActive: true })
        .session(session)
        .exec();
      if (!team) throw new NotFoundException('Không tìm thấy nhóm');
      await this.teamModel
        .updateOne({ _id: teamId }, { $inc: { revision: 1 } }, { session })
        .exec();
      const [doc] = await this.userModel.create([{ ...newUser, teamId }], {
        session,
      });
      return doc;
    });
    return toUserPublicProfile(created);
  }

  private assertRoleCanJoinTeam(role: UserRole): void {
    if (!TEAM_MEMBER_ROLES.includes(role)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Chỉ tài khoản vai trò Quản lý hoặc Nhân viên mới thuộc một nhóm',
        HttpStatus.BAD_REQUEST,
      );
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
        role: UserRole.ADMIN,
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
        { role: UserRole.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
        { $currentDate: { updatedAt: true } },
        { session, timestamps: false },
      )
      .exec();
  }

  private isActiveAdmin(user: { role: UserRole; status: UserStatus }): boolean {
    return user.role === UserRole.ADMIN && user.status === UserStatus.ACTIVE;
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
   * Cập nhật role + audit USER_ROLE_CHANGED cùng transaction.
   *
   * - Không cho hạ vai trò ADMIN đang hoạt động cuối cùng (409 LAST_ADMIN_REQUIRED).
   * - Đổi sang vai trò KHÔNG phải Quản lý thì gỡ người này khỏi `teams.managerIds`; sang vai trò không thuộc nhóm
   *   (ADMIN/EDITOR) thì xóa luôn `teamId` — để không còn "Quản lý ma" giữ quyền theo nhóm sau khi bị hạ vai trò.
   * - Đặt lại đúng vai trò hiện có là no-op (không audit).
   */
  async updateRole(
    id: string,
    dto: UpdateUserRoleDto,
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
      if (before.role === dto.role) return before;

      if (dto.role !== UserRole.ADMIN && this.isActiveAdmin(before)) {
        await this.assertAnotherActiveAdmin(userId, session);
      }

      const update: Record<string, unknown> = { role: dto.role };
      if (!TEAM_MEMBER_ROLES.includes(dto.role)) update.teamId = null;
      const after = await this.userModel
        .findOneAndUpdate(
          { _id: userId },
          { $set: update },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!after) throw new NotFoundException('User not found');

      if (dto.role !== UserRole.MANAGER) {
        await this.teamModel
          .updateMany(
            { managerIds: userId },
            { $pull: { managerIds: userId } },
            { session },
          )
          .exec();
      }

      // Mất nhóm do đổi vai trò (ADMIN/EDITOR không thuộc nhóm) cũng đổi phạm vi khách của Quản lý.
      if (String(before.teamId ?? '') !== String(after.teamId ?? '')) {
        await this.teamSync.syncForUser(userId, session);
      }

      await this.audit.record(
        {
          entityType: CrmAuditEntityType.USER,
          entityId: userId,
          action: CrmAuditAction.USER_ROLE_CHANGED,
          actor,
          changes: diffFields(before, after, ['role', 'teamId']),
        },
        session,
      );
      return after;
    });
    return toUserPublicProfile(doc);
  }
}
