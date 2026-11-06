/**
 * UsersService unit spec — contract mục 6.4 / 16.6 / 16.4.
 *
 * Bao phủ:
 * - findAll: phân trang chuẩn { data, meta: { total, page, limit, totalPages } },
 *   filter `deletedAt: null` (soft delete), sort createdAt desc, clamp limit [1,100].
 * - create: email trùng (chưa soft delete) → 409 Conflict; argon2.hash gọi 1 lần;
 *   email lowercase; status mặc định ACTIVE; trả UserPublicProfile KHÔNG chứa password.
 * - updateStatus: filter `_id + deletedAt: null`, `$set status`, `{ new: true }`,
 *   không tìm thấy → 404 NotFoundException.
 * - updateRole: cùng flow updateStatus nhưng `$set role`.
 *
 * Quy ước mock: model Mongoose mock dạng chainable `.find().sort().skip().limit().lean().exec()`
 * và `.findOne().lean().exec()`, `.findOneAndUpdate().lean().exec()`,
 * `.countDocuments().exec()`, `.create()`. `argon2` mock qua `jest.mock('argon2')`.
 *
 * KHÔNG sửa source — chỉ verify hành vi. Bug/lệch contract ghi nhận cuối báo cáo.
 */
jest.mock('argon2');
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { Team } from '../teams/schemas/team.schema';
import { RefreshToken } from '../auth/schemas/refresh-token.schema';
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
import { CustomerTeamSyncService } from '../crm/customers/customer-team-sync.service';
import { PushRevokedReason } from '../notifications/push/push-subscription.constants';
import { PushSubscriptionManagementService } from '../notifications/push/push-subscription-management.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import type { CreateUserDto } from './dtos/create-user.dto';
import type { UpdateUserStatusDto } from './dtos/update-user-status.dto';

/**
 * Tạo chainable Mongoose query mock cho các method `.sort().skip().limit().lean().exec()`,
 * `.findOne().lean().exec()`, `.findOneAndUpdate().lean().exec()`, `.countDocuments().exec()`.
 *
 * `finalValue` là giá trị mà `.exec()` resolve. Các method trung gian trả về chính chain.
 */
function chainable(finalValue: unknown = undefined): any {
  const chain: any = {};
  const chainFn = () => chain;
  for (const m of [
    'select',
    'lean',
    'sort',
    'skip',
    'limit',
    'populate',
    'session',
  ]) {
    chain[m] = jest.fn(chainFn);
  }
  chain.exec = jest.fn().mockResolvedValue(finalValue);
  return chain;
}

const USER_ID = '65e1f0a1b2c3d4e5f6a7b8c9';
/** Session giả do `connection.transaction` mock truyền vào `work`. */
const SESSION = { id: 'session' };
const EMAIL = 'editor@example.com';
const TEAM_A = '65e1f0a1b2c3d4e5f6a7b8d1';

/** Mặc định `roles`/`teamIds` suy từ `role`/`teamId` (khớp pre-validate hook của schema) trừ khi test truyền riêng. */
function buildUserDoc(overrides: Record<string, unknown> = {}) {
  const role = (overrides.role ?? UserRole.EDITOR) as UserRole;
  const teamId = overrides.teamId ?? null;
  return {
    _id: USER_ID,
    email: EMAIL,
    password: '$argon2id$hash',
    displayName: 'Editor One',
    role,
    roles: [role],
    status: UserStatus.ACTIVE,
    teamId,
    teamIds: teamId ? [teamId] : [],
    deletedAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

describe('UsersService (contract mục 6.4/16.6)', () => {
  let service: UsersService;
  let userModel: any;
  let teamModel: any;
  let refreshTokenModel: any;
  let connection: any;
  let audit: { record: jest.Mock };
  let pushSubscriptions: { revokeAllForUser: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$hashed');

    userModel = {
      find: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
    };
    refreshTokenModel = {
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };

    teamModel = {
      countDocuments: jest.fn(),
      updateMany: jest.fn(),
    };
    audit = { record: jest.fn() };
    pushSubscriptions = { revokeAllForUser: jest.fn().mockResolvedValue(0) };
    // Transaction giả: chạy `work` ngay với một session giả; phần ghi thật được kiểm ở integration test.
    connection = {
      transaction: jest.fn((work: (session: unknown) => unknown) =>
        Promise.resolve(work(SESSION)),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Team.name), useValue: teamModel },
        {
          provide: getModelToken(RefreshToken.name),
          useValue: refreshTokenModel,
        },
        { provide: getConnectionToken(), useValue: connection },
        { provide: CrmAuditLogService, useValue: audit },
        // Đồng bộ customers.teamIds được kiểm bằng integration thật (crm-m2.integration.spec.ts).
        {
          provide: CustomerTeamSyncService,
          useValue: { syncForUser: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: PushSubscriptionManagementService,
          useValue: pushSubscriptions,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('findAll (mục 6.4 — phân trang chuẩn)', () => {
    it('trả đúng shape { data, meta: { total, page, limit, totalPages } }', async () => {
      const findChain = chainable([buildUserDoc()]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(1));

      const result = await service.findAll(1, 20);

      // Response format phân trang chuẩn skill { data, meta: { total, page, limit, totalPages } }.
      expect(result).toEqual({
        data: [
          {
            _id: USER_ID,
            email: EMAIL,
            displayName: 'Editor One',
            role: UserRole.EDITOR,
            roles: [UserRole.EDITOR],
            status: UserStatus.ACTIVE,
            teamId: null,
            teamIds: [],
          },
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
      // UserPublicProfile KHÔNG chứa password (Least Privilege Data — chuẩn skill).
      expect((result.data[0] as any).password).toBeUndefined();
    });

    it('filter `deletedAt: null` (soft delete — không trả user đã xoá)', async () => {
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      await service.findAll(1, 20);

      // find được gọi với filter soft delete.
      expect(userModel.find).toHaveBeenCalledWith({ deletedAt: null });
      expect(userModel.countDocuments).toHaveBeenCalledWith({
        deletedAt: null,
      });
    });

    it('sort theo createdAt desc, skip=(page-1)*limit, limit=limit', async () => {
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      await service.findAll(2, 15);

      expect(findChain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(findChain.skip).toHaveBeenCalledWith(15); // (2-1)*15
      expect(findChain.limit).toHaveBeenCalledWith(15);
    });

    it('clamp limit về [1, 100] — limit=999 → 100', async () => {
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll(1, 999);

      expect(findChain.limit).toHaveBeenCalledWith(100);
      expect(result.meta.limit).toBe(100);
    });

    it('limit=0 → default 20 (Number(0) là falsy nên `|| 20` fall-back, KHÔNG phải 1)', async () => {
      // Lưu ý behavior thật: `Math.max(Number(0) || 20, 1)` = `Math.max(20, 1)` = 20.
      // Đây là một quirk — limit=0 được coi như "không hợp lệ" chứ không clamp về 1.
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll(1, 0);

      expect(result.meta.limit).toBe(20);
    });

    it('limit không hợp lệ (NaN/string) → default 20', async () => {
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll(1, 'abc' as any);

      expect(result.meta.limit).toBe(20);
    });

    it('page < 1 → coerce về 1', async () => {
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll(-5, 10);

      expect(result.meta.page).toBe(1);
      expect(findChain.skip).toHaveBeenCalledWith(0); // (1-1)*10
    });

    it('page không hợp lệ (NaN) → default 1', async () => {
      const findChain = chainable([]);
      userModel.find.mockReturnValue(findChain);
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll('xx' as any, 10);

      expect(result.meta.page).toBe(1);
    });

    it('totalPages = ceil(total/limit); total=25, limit=10 → 3', async () => {
      userModel.find.mockReturnValue(chainable([]));
      userModel.countDocuments.mockReturnValue(chainable(25));

      const result = await service.findAll(1, 10);

      expect(result.meta.totalPages).toBe(3);
    });

    it('total=0 → totalPages = 1 (không 0)', async () => {
      userModel.find.mockReturnValue(chainable([]));
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll(1, 20);

      // `|| 1` trong source — tránh totalPages=0.
      expect(result.meta.totalPages).toBe(1);
    });

    it('default page=1, limit=20 khi không truyền tham số', async () => {
      userModel.find.mockReturnValue(chainable([]));
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll();

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('data rỗng → data=[] (không null)', async () => {
      userModel.find.mockReturnValue(chainable([]));
      userModel.countDocuments.mockReturnValue(chainable(0));

      const result = await service.findAll(1, 20);

      expect(result.data).toEqual([]);
    });
  });

  describe('create (mục 6.4/16.4 — hash argon2, KHÔNG trả password)', () => {
    const dto: CreateUserDto = {
      email: 'Editor@Example.COM',
      password: 'Editor@123456',
      displayName: 'Editor One',
      role: UserRole.EDITOR,
    };

    it('email trùng (chưa soft delete) → ConflictException("Email already in use")', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow('Email already in use');
      // findOne filter email lowercase + deletedAt: null (soft delete).
      expect(userModel.findOne).toHaveBeenCalledWith({
        email: 'editor@example.com',
        deletedAt: null,
      });
      // Khi trùng, KHÔNG hash password (tiết kiệm CPU).
      expect(argon2.hash).not.toHaveBeenCalled();
    });

    it('email trùng nhưng đã soft delete (deletedAt != null) → KHÔNG tính trùng, tạo mới OK', async () => {
      // findOne trả null (không match) → email free để tạo lại.
      userModel.findOne.mockReturnValue(chainable(null));
      userModel.create.mockResolvedValue(buildUserDoc());

      const result = await service.create(dto);

      expect(userModel.create).toHaveBeenCalledTimes(1);
      expect(result.email).toBe(EMAIL);
    });

    it('argon2.hash gọi 1 lần với dto.password raw', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      userModel.create.mockResolvedValue(buildUserDoc());

      await service.create(dto);

      expect(argon2.hash).toHaveBeenCalledTimes(1);
      expect(argon2.hash).toHaveBeenCalledWith('Editor@123456');
    });

    it('email được lowercase trước khi lưu (chuẩn hoá để so khớp DB)', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      userModel.create.mockResolvedValue(buildUserDoc());

      await service.create(dto);

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'editor@example.com',
          password: '$argon2id$hashed',
          displayName: 'Editor One',
          role: UserRole.EDITOR,
        }),
      );
    });

    it('status mặc định ACTIVE, deletedAt=null, lastLoginAt=null khi tạo', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      userModel.create.mockResolvedValue(buildUserDoc());

      await service.create(dto);

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: UserStatus.ACTIVE,
          deletedAt: null,
          lastLoginAt: null,
        }),
      );
    });

    it('password lưu là hash (KHÔNG phải raw password)', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      userModel.create.mockResolvedValue(buildUserDoc());

      await service.create(dto);

      const createArg = userModel.create.mock.calls[0][0];
      expect(createArg.password).toBe('$argon2id$hashed');
      expect(createArg.password).not.toBe('Editor@123456');
    });

    it('trả UserPublicProfile KHÔNG chứa password (Least Privilege Data)', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      // create trả doc có password (giả lập DB trả lại đầy đủ).
      userModel.create.mockResolvedValue(buildUserDoc());

      const result = await service.create(dto);

      expect(result).toEqual({
        _id: USER_ID,
        email: EMAIL,
        displayName: 'Editor One',
        role: UserRole.EDITOR,
        roles: [UserRole.EDITOR],
        status: UserStatus.ACTIVE,
        teamId: null,
        teamIds: [],
      });
      expect((result as any).password).toBeUndefined();
      expect((result as any).deletedAt).toBeUndefined();
      expect((result as any).lastLoginAt).toBeUndefined();
    });
  });

  describe('updateStatus (block/unblock + audit + chặn khóa ADMIN cuối cùng)', () => {
    const ADMIN_ACTOR = { sub: '65e1f0a1b2c3d4e5f6a7b8aa' };
    const blockDto: UpdateUserStatusDto = { status: UserStatus.BLOCKED };

    it('không tìm thấy user (đã soft delete hoặc id sai) → NotFoundException("User not found"), không ghi gì', async () => {
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.updateStatus(USER_ID, blockDto, ADMIN_ACTOR),
      ).rejects.toThrow('User not found');
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('đặt lại đúng trạng thái hiện có là no-op: không update, không audit', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ status: UserStatus.BLOCKED })),
      );

      const result = await service.updateStatus(USER_ID, blockDto, ADMIN_ACTOR);

      expect(result.status).toBe(UserStatus.BLOCKED);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('khóa user thường: `$set status` trong transaction + audit USER_STATUS_CHANGED (cũ → mới), không lộ password', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ status: UserStatus.BLOCKED })),
      );

      const result = await service.updateStatus(USER_ID, blockDto, ADMIN_ACTOR);

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(USER_ID) },
        { $set: { status: UserStatus.BLOCKED } },
        { returnDocument: 'after', session: SESSION },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'USER',
          action: 'USER_STATUS_CHANGED',
          actor: ADMIN_ACTOR,
          changes: [{ field: 'status', from: 'ACTIVE', to: 'BLOCKED' }],
        }),
        SESSION,
      );
      expect(result.status).toBe(UserStatus.BLOCKED);
      expect((result as any).password).toBeUndefined();
      // User thường: không cần kiểm "ADMIN cuối cùng".
      expect(userModel.countDocuments).not.toHaveBeenCalled();
    });

    it('T-29: khóa user thu hồi mọi thiết bị push (ACCOUNT_DISABLED) cùng transaction', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ status: UserStatus.BLOCKED })),
      );

      await service.updateStatus(USER_ID, blockDto, ADMIN_ACTOR);

      expect(pushSubscriptions.revokeAllForUser).toHaveBeenCalledWith(
        new Types.ObjectId(USER_ID),
        PushRevokedReason.ACCOUNT_DISABLED,
        SESSION,
      );
    });

    it('T-29: mở khóa (ACTIVE) và no-op không thu hồi thiết bị push', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ status: UserStatus.BLOCKED })),
      );
      userModel.findOneAndUpdate.mockReturnValue(chainable(buildUserDoc()));

      await service.updateStatus(
        USER_ID,
        { status: UserStatus.ACTIVE },
        ADMIN_ACTOR,
      );

      expect(pushSubscriptions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('khóa ADMIN đang hoạt động CUỐI CÙNG → 409 LAST_ADMIN_REQUIRED, không update', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );
      userModel.countDocuments.mockReturnValue(chainable(0));

      await expect(
        service.updateStatus(USER_ID, blockDto, ADMIN_ACTOR),
      ).rejects.toMatchObject({ errorCode: 'LAST_ADMIN_REQUIRED' });
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('khóa ADMIN khi còn ADMIN khác: cho phép và "chạm" các ADMIN để hai lần khóa chéo nhau xung đột ghi', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );
      userModel.countDocuments.mockReturnValue(chainable(1));
      userModel.updateMany.mockReturnValue({ exec: jest.fn() });
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(
          buildUserDoc({ role: UserRole.ADMIN, status: UserStatus.BLOCKED }),
        ),
      );

      await service.updateStatus(USER_ID, blockDto, ADMIN_ACTOR);

      expect(userModel.updateMany).toHaveBeenCalledWith(
        { roles: UserRole.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
        { $currentDate: { updatedAt: true } },
        { session: SESSION, timestamps: false },
      );
    });
  });

  describe('updateRole / updateRoles (đổi role + audit + dọn nhóm + chặn hạ ADMIN cuối cùng)', () => {
    const ADMIN_ACTOR = { sub: '65e1f0a1b2c3d4e5f6a7b8aa' };
    const userId = new Types.ObjectId(USER_ID);

    it('không tìm thấy user → NotFoundException("User not found") và KHÔNG đụng teams', async () => {
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.updateRole(USER_ID, { role: UserRole.ADMIN }, ADMIN_ACTOR),
      ).rejects.toThrow('User not found');
      expect(teamModel.updateMany).not.toHaveBeenCalled();
    });

    it('đặt lại đúng tập role hiện có (kể cả khác thứ tự) là no-op: không update, không audit', async () => {
      userModel.findOne.mockReturnValue(
        chainable(
          buildUserDoc({
            role: UserRole.MANAGER,
            roles: [UserRole.STAFF, UserRole.MANAGER],
          }),
        ),
      );

      await service.updateRoles(
        USER_ID,
        { roles: [UserRole.MANAGER, UserRole.STAFF] },
        ADMIN_ACTOR,
      );

      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('PATCH role đơn trên tài khoản nhiều role KHÔNG phải no-op: thu về đúng một role', async () => {
      userModel.findOne.mockReturnValue(
        chainable(
          buildUserDoc({
            role: UserRole.MANAGER,
            roles: [UserRole.MANAGER, UserRole.STAFF],
          }),
        ),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.MANAGER })),
      );

      await service.updateRole(
        USER_ID,
        { role: UserRole.MANAGER },
        ADMIN_ACTOR,
      );

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        { $set: { roles: [UserRole.MANAGER], role: UserRole.MANAGER } },
        { returnDocument: 'after', session: SESSION },
      );
    });

    it('đổi sang MANAGER: `$set` roles + role cao nhất, KHÔNG đụng teams; audit USER_ROLE_CHANGED ghi roles cũ/mới', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.MANAGER })),
      );

      await service.updateRole(
        USER_ID,
        { role: UserRole.MANAGER },
        ADMIN_ACTOR,
      );

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        { $set: { roles: [UserRole.MANAGER], role: UserRole.MANAGER } },
        { returnDocument: 'after', session: SESSION },
      );
      expect(teamModel.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          changes: [{ field: 'roles', from: ['EDITOR'], to: ['MANAGER'] }],
        }),
        SESSION,
      );
    });

    it('roles khử trùng và sắp theo độ ưu tiên; role = cao nhất (STAFF+MANAGER → MANAGER), giữ nguyên nhóm', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.STAFF, teamId: TEAM_A })),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(
          buildUserDoc({
            role: UserRole.MANAGER,
            roles: [UserRole.MANAGER, UserRole.STAFF],
            teamId: TEAM_A,
          }),
        ),
      );

      await service.updateRoles(
        USER_ID,
        { roles: [UserRole.STAFF, UserRole.MANAGER, UserRole.STAFF] },
        ADMIN_ACTOR,
      );

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        {
          $set: {
            roles: [UserRole.MANAGER, UserRole.STAFF],
            role: UserRole.MANAGER,
          },
        },
        expect.anything(),
      );
      expect(teamModel.updateMany).not.toHaveBeenCalled();
    });

    it('roles rỗng/không hợp lệ → 400, không mở transaction', async () => {
      await expect(
        service.updateRoles(USER_ID, { roles: [] }, ADMIN_ACTOR),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('không còn role MANAGER/STAFF (ADMIN): xóa teamId + teamIds và gỡ khỏi managerIds trong CÙNG transaction', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.STAFF, teamId: TEAM_A })),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });

      const result = await service.updateRole(
        USER_ID,
        { role: UserRole.ADMIN },
        ADMIN_ACTOR,
      );

      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        {
          $set: {
            roles: [UserRole.ADMIN],
            role: UserRole.ADMIN,
            teamIds: [],
            teamId: null,
          },
        },
        { returnDocument: 'after', session: SESSION },
      );
      expect(teamModel.updateMany).toHaveBeenCalledWith(
        { managerIds: userId },
        { $pull: { managerIds: userId } },
        { session: SESSION },
      );
      expect(result.role).toBe(UserRole.ADMIN);
      expect((result as any).password).toBeUndefined();
    });

    it('hạ MANAGER xuống STAFF: giữ nhóm của người dùng nhưng vẫn gỡ khỏi managerIds', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.MANAGER, teamId: TEAM_A })),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.STAFF, teamId: TEAM_A })),
      );
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });

      await service.updateRole(USER_ID, { role: UserRole.STAFF }, ADMIN_ACTOR);

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { roles: [UserRole.STAFF], role: UserRole.STAFF } },
        expect.anything(),
      );
      expect(teamModel.updateMany).toHaveBeenCalledTimes(1);
    });

    it('hạ ADMIN đang hoạt động CUỐI CÙNG → 409 LAST_ADMIN_REQUIRED, không update', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );
      userModel.countDocuments.mockReturnValue(chainable(0));

      await expect(
        service.updateRole(USER_ID, { role: UserRole.STAFF }, ADMIN_ACTOR),
      ).rejects.toMatchObject({ errorCode: 'LAST_ADMIN_REQUIRED' });
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(teamModel.updateMany).not.toHaveBeenCalled();
    });

    it('ADMIN+STAFF bỏ ADMIN (còn STAFF) cũng bị chặn nếu là ADMIN cuối cùng; giữ ADMIN thì không cần kiểm', async () => {
      const adminStaff = buildUserDoc({
        role: UserRole.ADMIN,
        roles: [UserRole.ADMIN, UserRole.STAFF],
      });
      userModel.findOne.mockReturnValue(chainable(adminStaff));
      userModel.countDocuments.mockReturnValue(chainable(0));

      await expect(
        service.updateRoles(USER_ID, { roles: [UserRole.STAFF] }, ADMIN_ACTOR),
      ).rejects.toMatchObject({ errorCode: 'LAST_ADMIN_REQUIRED' });

      userModel.countDocuments.mockClear();
      userModel.findOneAndUpdate.mockReturnValue(chainable(adminStaff));
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });
      await service.updateRoles(
        USER_ID,
        { roles: [UserRole.ADMIN, UserRole.EDITOR] },
        ADMIN_ACTOR,
      );
      expect(userModel.countDocuments).not.toHaveBeenCalled();
    });

    it('nâng lên ADMIN không cần kiểm "ADMIN cuối cùng"', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });

      await service.updateRole(USER_ID, { role: UserRole.ADMIN }, ADMIN_ACTOR);

      expect(userModel.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile (sửa tên/email + audit + thu hồi phiên khi đổi email)', () => {
    const ADMIN_ACTOR = { sub: '65e1f0a1b2c3d4e5f6a7b8aa' };
    const userId = new Types.ObjectId(USER_ID);

    it('body rỗng → 400 VALIDATION_FAILED, không mở transaction', async () => {
      await expect(
        service.updateProfile(USER_ID, {}, ADMIN_ACTOR),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('user không tồn tại (hoặc đã soft delete) → 404, không ghi gì', async () => {
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.updateProfile(
          USER_ID,
          { displayName: 'New Name' },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('sửa tên: chỉ `$set displayName`, ghi audit USER_UPDATED, KHÔNG thu hồi phiên', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ displayName: 'New Name' })),
      );

      const result = await service.updateProfile(
        USER_ID,
        { displayName: 'New Name' },
        ADMIN_ACTOR,
      );

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        { $set: { displayName: 'New Name' } },
        { returnDocument: 'after', session: SESSION },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'USER',
          action: 'USER_UPDATED',
          actor: ADMIN_ACTOR,
          changes: [
            { field: 'displayName', from: 'Editor One', to: 'New Name' },
          ],
        }),
        SESSION,
      );
      expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        _id: USER_ID,
        email: EMAIL,
        displayName: 'New Name',
        role: UserRole.EDITOR,
        roles: [UserRole.EDITOR],
        status: UserStatus.ACTIVE,
        teamId: null,
        teamIds: [],
      });
    });

    it('sửa email: chuẩn hóa chữ thường, kiểm trùng loại trừ chính nó, thu hồi mọi refresh token của user', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.exists.mockReturnValue(chainable(null));
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ email: 'new@example.com' })),
      );

      const result = await service.updateProfile(
        USER_ID,
        { email: 'New@Example.COM' },
        ADMIN_ACTOR,
      );

      expect(userModel.exists).toHaveBeenCalledWith({
        _id: { $ne: userId },
        email: 'new@example.com',
        deletedAt: null,
      });
      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId },
        { $set: { email: 'new@example.com' } },
        { returnDocument: 'after', session: SESSION },
      );
      expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
        { userId, isRevoked: false },
        { $set: { isRevoked: true } },
        { session: SESSION },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: [{ field: 'email', from: EMAIL, to: 'new@example.com' }],
        }),
        SESSION,
      );
      expect(result.email).toBe('new@example.com');
    });

    it('email trùng tài khoản khác → 409 "Email already in use", không update/thu hồi/audit', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.exists.mockReturnValue(chainable({ _id: 'other' }));

      await expect(
        service.updateProfile(
          USER_ID,
          { email: 'taken@example.com' },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(new ConflictException('Email already in use'));
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('hai request đổi email cùng lúc: lỗi E11000 từ unique index cũng thành 409', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));
      userModel.exists.mockReturnValue(chainable(null));
      userModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.reject(Object.assign(new Error('E11000'), { code: 11000 })),
        }),
      });

      await expect(
        service.updateProfile(
          USER_ID,
          { email: 'race@example.com' },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resetPassword (đặt lại mật khẩu + thu hồi phiên + audit không lộ mật khẩu)', () => {
    const ADMIN_ACTOR = { sub: '65e1f0a1b2c3d4e5f6a7b8aa' };
    const userId = new Types.ObjectId(USER_ID);

    it('hash argon2 mật khẩu mới, lưu hash, thu hồi mọi refresh token, audit USER_PASSWORD_RESET không chứa mật khẩu', async () => {
      userModel.findOneAndUpdate.mockReturnValue(chainable(buildUserDoc()));

      const result = await service.resetPassword(
        USER_ID,
        { newPassword: 'NewPass@123456' },
        ADMIN_ACTOR,
      );

      expect(argon2.hash).toHaveBeenCalledWith('NewPass@123456');
      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: userId, deletedAt: null },
        { $set: { password: '$argon2id$hashed' } },
        { returnDocument: 'after', session: SESSION },
      );
      expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
        { userId, isRevoked: false },
        { $set: { isRevoked: true } },
        { session: SESSION },
      );
      const [entry] = audit.record.mock.calls[0];
      expect(entry).toMatchObject({
        entityType: 'USER',
        action: 'USER_PASSWORD_RESET',
        actor: ADMIN_ACTOR,
      });
      expect(JSON.stringify(entry)).not.toMatch(/NewPass|argon2id/);
      expect(result).toEqual({
        _id: USER_ID,
        email: EMAIL,
        displayName: 'Editor One',
        role: UserRole.EDITOR,
        roles: [UserRole.EDITOR],
        status: UserStatus.ACTIVE,
        teamId: null,
        teamIds: [],
      });
    });

    it('user không tồn tại → 404, không thu hồi phiên, không audit', async () => {
      userModel.findOneAndUpdate.mockReturnValue(chainable(null));

      await expect(
        service.resetPassword(
          USER_ID,
          { newPassword: 'NewPass@123456' },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('findAll — bộ lọc CRM (tài liệu 05 mục 2.2)', () => {
    it('lọc theo role (có role đó trong roles)/status/teamId (có nhóm đó trong teamIds) và q (escape regex) trên cùng filter cho cả find và count', async () => {
      userModel.find.mockReturnValue(chainable([]));
      userModel.countDocuments.mockReturnValue(chainable(0));
      const teamId = '65e1f0a1b2c3d4e5f6a7b8d1';

      await service.findAll(1, 20, {
        role: UserRole.STAFF,
        status: UserStatus.ACTIVE,
        teamId,
        q: 'a.b*',
      });

      const filter = userModel.find.mock.calls[0][0];
      expect(filter).toMatchObject({
        deletedAt: null,
        roles: UserRole.STAFF,
        status: UserStatus.ACTIVE,
        teamIds: new Types.ObjectId(teamId),
      });
      // `q` phải bị escape: "a.b*" chỉ khớp đúng chuỗi đó, không khớp "axbb".
      const [{ displayName }] = filter.$or;
      expect(displayName.test('xx a.b* yy')).toBe(true);
      expect(displayName.test('axbb')).toBe(false);
      expect(userModel.countDocuments).toHaveBeenCalledWith(filter);
    });
  });

  describe('create — teamId (CRM)', () => {
    const baseDto: CreateUserDto = {
      email: 'staff@example.com',
      password: 'Staff@123456',
      displayName: 'Staff One',
      role: UserRole.STAFF,
    };
    const TEAM_ID = '65e1f0a1b2c3d4e5f6a7b8d1';

    it('có nhóm hợp lệ: kiểm nhóm, tăng revision của nhóm ("khóa ghi") và tạo user trong CÙNG transaction', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      teamModel.countDocuments.mockReturnValue(chainable(1));
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });
      userModel.create.mockResolvedValue([
        buildUserDoc({ role: UserRole.STAFF, teamId: TEAM_ID }),
      ]);

      const result = await service.create({ ...baseDto, teamId: TEAM_ID });

      const teamObjectId = new Types.ObjectId(TEAM_ID);
      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(teamModel.countDocuments).toHaveBeenCalledWith({
        _id: { $in: [teamObjectId] },
        deletedAt: null,
        isActive: true,
      });
      expect(teamModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [teamObjectId] } },
        { $inc: { revision: 1 } },
        { session: SESSION },
      );
      expect(userModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            teamId: teamObjectId,
            teamIds: [teamObjectId],
            role: UserRole.STAFF,
            roles: [UserRole.STAFF],
          }),
        ],
        { session: SESSION },
      );
      expect(result.teamId).toBe(TEAM_ID);
      expect(result.teamIds).toEqual([TEAM_ID]);
    });

    it('nhiều role + nhiều nhóm: role = cao nhất, teamId = nhóm đầu tiên, mọi nhóm được khóa ghi', async () => {
      const TEAM_B = '65e1f0a1b2c3d4e5f6a7b8d2';
      userModel.findOne.mockReturnValue(chainable(null));
      teamModel.countDocuments.mockReturnValue(chainable(2));
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });
      userModel.create.mockResolvedValue([buildUserDoc()]);

      await service.create({
        ...baseDto,
        role: undefined,
        roles: [UserRole.STAFF, UserRole.MANAGER, UserRole.STAFF],
        teamIds: [TEAM_B, TEAM_ID, TEAM_B],
      });

      const teamB = new Types.ObjectId(TEAM_B);
      const teamA = new Types.ObjectId(TEAM_ID);
      expect(userModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            role: UserRole.MANAGER,
            roles: [UserRole.MANAGER, UserRole.STAFF],
            teamId: teamB,
            teamIds: [teamB, teamA],
          }),
        ],
        { session: SESSION },
      );
    });

    it('gửi cả role lẫn roles mâu thuẫn (role ≠ role cao nhất) → 400 rõ ràng, không tạo user; khớp thì chấp nhận', async () => {
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.create({
          ...baseDto,
          role: UserRole.STAFF,
          roles: [UserRole.MANAGER, UserRole.STAFF],
        }),
      ).rejects.toMatchObject({
        errorCode: 'VALIDATION_FAILED',
        message: expect.stringContaining('role cao nhất'),
      });
      expect(userModel.create).not.toHaveBeenCalled();

      userModel.create.mockResolvedValue(buildUserDoc());
      await service.create({
        ...baseDto,
        role: UserRole.MANAGER,
        roles: [UserRole.STAFF, UserRole.MANAGER],
      });
      expect(userModel.create).toHaveBeenCalledTimes(1);
    });

    it('gửi cả teamId lẫn teamIds mâu thuẫn (teamId ≠ teamIds[0], kể cả teamIds rỗng) → 400, không mở transaction', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      const TEAM_B = '65e1f0a1b2c3d4e5f6a7b8d2';

      for (const teamIds of [[TEAM_B, TEAM_ID], []]) {
        await expect(
          service.create({ ...baseDto, teamId: TEAM_ID, teamIds }),
        ).rejects.toMatchObject({
          errorCode: 'VALIDATION_FAILED',
          message: expect.stringContaining('teamIds'),
        });
      }
      expect(connection.transaction).not.toHaveBeenCalled();
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('teamId trùng teamIds[0] (chữ hoa/thường hex không quan trọng) → hợp lệ', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      teamModel.countDocuments.mockReturnValue(chainable(1));
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });
      userModel.create.mockResolvedValue([buildUserDoc()]);

      await service.create({
        ...baseDto,
        teamId: TEAM_ID.toUpperCase(),
        teamIds: [TEAM_ID],
      });

      expect(userModel.create).toHaveBeenCalledTimes(1);
    });

    it('từ chối teamId với vai trò không thuộc nhóm (EDITOR) bằng 400 VALIDATION_FAILED, không tạo user', async () => {
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.create({ ...baseDto, role: UserRole.EDITOR, teamId: TEAM_ID }),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
      expect(userModel.create).not.toHaveBeenCalled();
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('nhóm không tồn tại/đã ngừng → 404, không tạo user', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      teamModel.countDocuments.mockReturnValue(chainable(0));

      await expect(
        service.create({ ...baseDto, teamId: TEAM_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(userModel.create).not.toHaveBeenCalled();
    });
  });

  describe('create — E11000 email trùng do race (FR-22)', () => {
    const baseDto: CreateUserDto = {
      email: 'race@example.com',
      password: 'Staff@123456',
      displayName: 'Race',
      role: UserRole.STAFF,
    };
    const TEAM_ID = '65e1f0a1b2c3d4e5f6a7b8d1';
    const dupError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });

    it('FR-22: nhánh không teamIds — create ném E11000 → ConflictException(Email already in use)', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      userModel.create.mockRejectedValue(dupError);

      const promise = service.create(baseDto);

      await expect(promise).rejects.toThrow(ConflictException);
      await expect(promise).rejects.toThrow('Email already in use');
    });

    it('FR-22: nhánh có teamIds — create trong transaction ném E11000 → ConflictException(Email already in use)', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      teamModel.countDocuments.mockReturnValue(chainable(1));
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });
      userModel.create.mockRejectedValue(dupError);

      const promise = service.create({ ...baseDto, teamIds: [TEAM_ID] });

      await expect(promise).rejects.toThrow(ConflictException);
      await expect(promise).rejects.toThrow('Email already in use');
    });

    it('FR-22: lỗi khác E11000 vẫn ném nguyên (không bị nuốt thành 409)', async () => {
      userModel.findOne.mockReturnValue(chainable(null));
      const other = new Error('boom');
      userModel.create.mockRejectedValue(other);

      await expect(service.create(baseDto)).rejects.toBe(other);
    });
  });
});
