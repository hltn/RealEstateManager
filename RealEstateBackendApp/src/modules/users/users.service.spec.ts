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
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
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

function buildUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_ID,
    email: EMAIL,
    password: '$argon2id$hash',
    displayName: 'Editor One',
    role: UserRole.EDITOR,
    status: UserStatus.ACTIVE,
    teamId: null,
    deletedAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

describe('UsersService (contract mục 6.4/16.6)', () => {
  let service: UsersService;
  let userModel: any;
  let teamModel: any;
  let connection: any;
  let audit: { record: jest.Mock };

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
    };

    teamModel = {
      exists: jest.fn(),
      updateMany: jest.fn(),
      updateOne: jest.fn(),
    };
    audit = { record: jest.fn() };
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
        { provide: getConnectionToken(), useValue: connection },
        { provide: CrmAuditLogService, useValue: audit },
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
            status: UserStatus.ACTIVE,
            teamId: null,
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
        status: UserStatus.ACTIVE,
        teamId: null,
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
        { role: UserRole.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
        { $currentDate: { updatedAt: true } },
        { session: SESSION, timestamps: false },
      );
    });
  });

  describe('updateRole (đổi role + audit + dọn nhóm + chặn hạ ADMIN cuối cùng)', () => {
    const ADMIN_ACTOR = { sub: '65e1f0a1b2c3d4e5f6a7b8aa' };
    const userId = new Types.ObjectId(USER_ID);

    it('không tìm thấy user → NotFoundException("User not found") và KHÔNG đụng teams', async () => {
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(
        service.updateRole(USER_ID, { role: UserRole.ADMIN }, ADMIN_ACTOR),
      ).rejects.toThrow('User not found');
      expect(teamModel.updateMany).not.toHaveBeenCalled();
    });

    it('đặt lại đúng vai trò hiện có là no-op: không update, không audit', async () => {
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));

      await service.updateRole(USER_ID, { role: UserRole.EDITOR }, ADMIN_ACTOR);

      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('đổi sang MANAGER: chỉ `$set role`, KHÔNG đụng teams; ghi audit USER_ROLE_CHANGED', async () => {
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
        { $set: { role: UserRole.MANAGER } },
        { returnDocument: 'after', session: SESSION },
      );
      expect(teamModel.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          changes: [{ field: 'role', from: 'EDITOR', to: 'MANAGER' }],
        }),
        SESSION,
      );
    });

    it('đổi sang vai trò không thuộc nhóm (ADMIN): xóa teamId và gỡ khỏi managerIds trong CÙNG transaction', async () => {
      userModel.findOne.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.STAFF })),
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
        { $set: { role: UserRole.ADMIN, teamId: null } },
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
        chainable(buildUserDoc({ role: UserRole.MANAGER })),
      );
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.STAFF })),
      );
      teamModel.updateMany.mockReturnValue({ exec: jest.fn() });

      await service.updateRole(USER_ID, { role: UserRole.STAFF }, ADMIN_ACTOR);

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { role: UserRole.STAFF } },
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

  describe('findAll — bộ lọc CRM (tài liệu 05 mục 2.2)', () => {
    it('lọc theo role/status/teamId và q (escape regex) trên cùng filter cho cả find và count', async () => {
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
        role: UserRole.STAFF,
        status: UserStatus.ACTIVE,
        teamId: new Types.ObjectId(teamId),
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
      teamModel.exists.mockReturnValue(chainable({ _id: TEAM_ID }));
      teamModel.updateOne.mockReturnValue({ exec: jest.fn() });
      userModel.create.mockResolvedValue([
        buildUserDoc({ role: UserRole.STAFF, teamId: TEAM_ID }),
      ]);

      const result = await service.create({ ...baseDto, teamId: TEAM_ID });

      const teamObjectId = new Types.ObjectId(TEAM_ID);
      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(teamModel.exists).toHaveBeenCalledWith({
        _id: teamObjectId,
        deletedAt: null,
        isActive: true,
      });
      expect(teamModel.updateOne).toHaveBeenCalledWith(
        { _id: teamObjectId },
        { $inc: { revision: 1 } },
        { session: SESSION },
      );
      expect(userModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            teamId: teamObjectId,
            role: UserRole.STAFF,
          }),
        ],
        { session: SESSION },
      );
      expect(result.teamId).toBe(TEAM_ID);
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
      teamModel.exists.mockReturnValue(chainable(null));

      await expect(
        service.create({ ...baseDto, teamId: TEAM_ID }),
      ).rejects.toThrow(NotFoundException);
      expect(userModel.create).not.toHaveBeenCalled();
    });
  });
});
