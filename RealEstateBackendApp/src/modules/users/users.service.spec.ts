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
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { User, UserDocument } from './schemas/user.schema';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import type { CreateUserDto } from './dtos/create-user.dto';
import type { UpdateUserStatusDto } from './dtos/update-user-status.dto';
import type { UpdateUserRoleDto } from './dtos/update-user-role.dto';

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
  ]) {
    chain[m] = jest.fn(chainFn);
  }
  chain.exec = jest.fn(async () => finalValue);
  return chain;
}

const USER_ID = '65e1f0a1b2c3d4e5f6a7b8c9';
const EMAIL = 'editor@example.com';

function buildUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_ID,
    email: EMAIL,
    password: '$argon2id$hash',
    displayName: 'Editor One',
    role: UserRole.EDITOR,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

describe('UsersService (contract mục 6.4/16.6)', () => {
  let service: UsersService;
  let userModel: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$hashed');

    userModel = {
      find: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
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
      });
      expect((result as any).password).toBeUndefined();
      expect((result as any).deletedAt).toBeUndefined();
      expect((result as any).lastLoginAt).toBeUndefined();
    });
  });

  describe('updateStatus (mục 6.4 — block/unblock)', () => {
    const dto: UpdateUserStatusDto = { status: UserStatus.BLOCKED };

    it('filter `_id + deletedAt: null`, `$set status`, `{ new: true }`', async () => {
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ status: UserStatus.BLOCKED })),
      );

      await service.updateStatus(USER_ID, dto);

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(USER_ID),
          deletedAt: null,
        },
        { $set: { status: UserStatus.BLOCKED } },
        { new: true },
      );
    });

    it('trả doc đã update KHÔNG chứa password', async () => {
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ status: UserStatus.BLOCKED })),
      );

      const result = await service.updateStatus(USER_ID, dto);

      expect(result.status).toBe(UserStatus.BLOCKED);
      expect((result as any).password).toBeUndefined();
    });

    it('không tìm thấy user (đã soft delete hoặc id sai) → NotFoundException("User not found")', async () => {
      userModel.findOneAndUpdate.mockReturnValue(chainable(null));

      await expect(service.updateStatus(USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.updateStatus(USER_ID, dto)).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('updateRole (mục 6.4 — đổi role)', () => {
    const dto: UpdateUserRoleDto = { role: UserRole.ADMIN };

    it('filter `_id + deletedAt: null`, `$set role`, `{ new: true }`', async () => {
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );

      await service.updateRole(USER_ID, dto);

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: new Types.ObjectId(USER_ID),
          deletedAt: null,
        },
        { $set: { role: UserRole.ADMIN } },
        { new: true },
      );
    });

    it('trả doc đã update KHÔNG chứa password', async () => {
      userModel.findOneAndUpdate.mockReturnValue(
        chainable(buildUserDoc({ role: UserRole.ADMIN })),
      );

      const result = await service.updateRole(USER_ID, dto);

      expect(result.role).toBe(UserRole.ADMIN);
      expect((result as any).password).toBeUndefined();
    });

    it('không tìm thấy user → NotFoundException("User not found")', async () => {
      userModel.findOneAndUpdate.mockReturnValue(chainable(null));

      await expect(service.updateRole(USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.updateRole(USER_ID, dto)).rejects.toThrow(
        'User not found',
      );
    });
  });
});
