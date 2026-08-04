/**
 * AuthService unit spec — contract mục 16.1 / 7.2.1–7.2.3 / 7.4.1.
 *
 * Bao phủ:
 * - validateUser: sai pass / không tìm thấy user → null; đúng → UserDocument.
 * - login: sai credentials → 401; BLOCKED → 403; thành công → accessToken +
 *   user (UserPublicDto KHÔNG chứa password/status) + refreshToken raw.
 * - refresh: 4 nhánh reuse detection + CAS race (nhánh 5).
 * - logout: idempotent (token không tồn tại → no-op; có token → revoke).
 * - revokeFamily: updateMany theo familyId.
 * - seedAdmin: 5 edge cases theo mục 16.9/7.4.1.
 *
 * Quy ước mock: model Mongoose mock dạng chainable `.findOne().select().lean().exec()`.
 * `argon2` mock qua `jest.mock('argon2')`. `crypto` (SHA-256, randomUUID) dùng thật.
 */
jest.mock('argon2');
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { User } from '../users/schemas/user.schema';
import { RefreshToken } from './schemas/refresh-token.schema';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { CustomLogger } from '../../common/logger/custom-logger.service';

/**
 * Tạo chainable Mongoose query mock cho các method `.select().lean().exec()`,
 * `.updateOne().exec()`, `.findOneAndUpdate().lean().exec()`...
 *
 * `finalValue` là giá trị mà `.exec()` resolve. Các method trung gian trả về
 * chính chain (để chain tiếp). Dùng cho `findOne`/`findById`/`find`/`findOneAndUpdate`/`updateOne`/`updateMany`.
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
  // Cài sẵn cho `findOne`/`findById`/`find`/`findOneAndUpdate`/`updateOne`/`updateMany`.
  return chain;
}

const USER_ID = '65e1f0a1b2c3d4e5f6a7b8c9';
const EMAIL = 'admin@example.com';

function buildUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_ID,
    email: EMAIL,
    password: '$argon2id$hash',
    displayName: 'System Admin',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    lastLoginAt: null,
    ...overrides,
  };
}

describe('AuthService (contract mục 16.1)', () => {
  let service: AuthService;
  let userModel: any;
  let refreshTokenModel: any;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<CustomLogger>;
  const jwtSignMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$hashed');
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    userModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };
    refreshTokenModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn(),
    };

    jwtService = { signAsync: jwtSignMock } as unknown as jest.Mocked<JwtService>;
    jwtSignMock.mockResolvedValue('access.jwt.token');

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        if (key === 'ADMIN_EMAIL') return 'admin@example.com';
        if (key === 'ADMIN_PASSWORD') return 'Admin@123456';
        if (key === 'ADMIN_DISPLAY_NAME') return 'System Admin';
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<CustomLogger>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: getModelToken(RefreshToken.name),
          useValue: refreshTokenModel,
        },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: CustomLogger, useValue: logger },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('validateUser (mục 16.1)', () => {
    it('không tìm thấy user → trả null, KHÔNG throw', async () => {
      const chain = chainable(null);
      userModel.findOne.mockReturnValue(chain);

      const result = await service.validateUser(EMAIL, 'password123');

      expect(result).toBeNull();
      // `.select('+password')` để lấy hash verify — không trả hash ra DTO mặc định.
      expect(chain.select).toHaveBeenCalledWith('+password');
      expect(chain.lean).toHaveBeenCalled();
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('sai password (argon2.verify false) → trả null, KHÔNG throw', async () => {
      const chain = chainable(buildUserDoc());
      userModel.findOne.mockReturnValue(chain);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(EMAIL, 'wrongpass');

      expect(result).toBeNull();
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$hash',
        'wrongpass',
      );
    });

    it('đúng password → trả UserDocument (kèm password để login dùng)', async () => {
      const chain = chainable(buildUserDoc());
      userModel.findOne.mockReturnValue(chain);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser(EMAIL, 'password123');

      expect(result).not.toBeNull();
      expect((result as any).email).toBe(EMAIL);
    });
  });

  describe('login (mục 16.1 + 6.3)', () => {
    it('sai credentials → UnauthorizedException("Invalid email or password")', async () => {
      jest.spyOn(service, 'validateUser').mockResolvedValue(null);

      await expect(
        service.login({ email: EMAIL, password: 'wrongpass' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ email: EMAIL, password: 'wrongpass' }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('user status=BLOCKED → ForbiddenException("Account is blocked")', async () => {
      jest
        .spyOn(service, 'validateUser')
        .mockResolvedValue(buildUserDoc({ status: UserStatus.BLOCKED }) as any);

      await expect(
        service.login({ email: EMAIL, password: 'password123' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.login({ email: EMAIL, password: 'password123' }),
      ).rejects.toThrow('Account is blocked');
    });

    it('login thành công → trả accessToken + user (UserPublicDto) + refreshToken raw', async () => {
      jest
        .spyOn(service, 'validateUser')
        .mockResolvedValue(buildUserDoc() as any);
      refreshTokenModel.create.mockResolvedValue({});
      // fire-and-forget updateOne lastLoginAt — trả chainable để .exec() resolve.
      userModel.updateOne.mockReturnValue(chainable({}));

      const result = await service.login({
        email: EMAIL,
        password: 'password123',
      });

      expect(result.accessToken).toBe('access.jwt.token');
      // UserPublicDto: chỉ {_id, email, displayName, role} — KHÔNG password/status.
      expect(result.user).toEqual({
        _id: USER_ID,
        email: EMAIL,
        displayName: 'System Admin',
        role: UserRole.ADMIN,
      });
      expect((result.user as any).password).toBeUndefined();
      expect((result.user as any).status).toBeUndefined();
      // Refresh token raw (UUID) trả về để controller set cookie.
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);
      // signAsync với payload { sub (ObjectId string), email, role } — không nhét password.
      expect(jwtSignMock).toHaveBeenCalledWith({
        sub: USER_ID,
        email: EMAIL,
        role: UserRole.ADMIN,
      });
      // Refresh token được create 1 lần (hash lưu DB, raw trả client).
      expect(refreshTokenModel.create).toHaveBeenCalledTimes(1);
    });

    it('login thành công → cập nhật lastLoginAt (fire-and-forget)', async () => {
      jest
        .spyOn(service, 'validateUser')
        .mockResolvedValue(buildUserDoc() as any);
      refreshTokenModel.create.mockResolvedValue({});
      const updateChain = chainable({});
      userModel.updateOne.mockReturnValue(updateChain);

      await service.login({ email: EMAIL, password: 'password123' });

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: USER_ID },
        { $set: { lastLoginAt: expect.any(Date) } },
      );
    });
  });

  describe('refresh — 4 nhánh + CAS race (mục 7.2.1 / 16.3)', () => {
    const RAW = 'refresh-token-uuid-1';
    // tokenHash = SHA-256 của RAW (dùng thật crypto)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(RAW).digest('hex');

    it('nhánh 1: token không tồn tại → 401 "Invalid or expired refresh token", revokeFamily KHÔNG gọi', async () => {
      refreshTokenModel.findOne.mockReturnValue(chainable(null));
      const updateManySpy = jest.spyOn(service, 'revokeFamily').mockResolvedValue();

      await expect(service.refresh(RAW)).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(updateManySpy).not.toHaveBeenCalled();
    });

    it('nhánh 2: hết hạn (isRevoked=false, expiresAt<now) → 401 cùng msg, revokeFamily KHÔNG gọi', async () => {
      refreshTokenModel.findOne.mockReturnValue(
        chainable({
          tokenHash,
          familyId: 'fam-1',
          isRevoked: false,
          expiresAt: new Date(Date.now() - 1000),
          userId: USER_ID,
        }),
      );
      const updateManySpy = jest.spyOn(service, 'revokeFamily').mockResolvedValue();

      await expect(service.refresh(RAW)).rejects.toThrow(
        'Invalid or expired refresh token',
      );
      expect(updateManySpy).not.toHaveBeenCalled();
    });

    it('nhánh 3: isRevoked=true → 401 "Refresh token reuse detected", revokeFamily gọi 1 lần', async () => {
      refreshTokenModel.findOne.mockReturnValue(
        chainable({
          tokenHash,
          familyId: 'fam-1',
          isRevoked: true,
          expiresAt: new Date(Date.now() + 10000),
          userId: USER_ID,
        }),
      );
      const revokeSpy = jest
        .spyOn(service, 'revokeFamily')
        .mockResolvedValue(undefined);

      await expect(service.refresh(RAW)).rejects.toThrow(
        'Refresh token reuse detected',
      );
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith('fam-1');
    });

    it('nhánh 4: token hợp lệ → mark old revoked (CAS) + create token mới cùng familyId + sign accessToken mới', async () => {
      const existing = {
        tokenHash,
        familyId: 'fam-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 10000),
        userId: USER_ID,
      };
      refreshTokenModel.findOne.mockReturnValue(chainable(existing));
      // CAS thành công (returnDocument: 'before' → trả old doc)
      refreshTokenModel.findOneAndUpdate.mockReturnValue(chainable(existing));
      refreshTokenModel.create.mockResolvedValue({});
      userModel.findOne.mockReturnValue(chainable(buildUserDoc()));

      const result = await service.refresh(RAW);

      // CAS filter đúng { tokenHash, isRevoked: false }
      expect(refreshTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tokenHash, isRevoked: false },
        {
          $set: {
            isRevoked: true,
            replacedByTokenHash: expect.any(String),
          },
        },
        { returnDocument: 'before' },
      );
      // Token mới tạo cùng familyId (kế thừa phiên).
      expect(refreshTokenModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1', isRevoked: false }),
      );
      expect(result.accessToken).toBe('access.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('nhánh 5 (CAS race): findOneAndUpdate trả null → coi như reuse → revokeFamily + 401 "Refresh token reuse detected"', async () => {
      const existing = {
        tokenHash,
        familyId: 'fam-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 10000),
        userId: USER_ID,
      };
      refreshTokenModel.findOne.mockReturnValue(chainable(existing));
      // CAS thua race → null
      refreshTokenModel.findOneAndUpdate.mockReturnValue(chainable(null));
      const revokeSpy = jest
        .spyOn(service, 'revokeFamily')
        .mockResolvedValue(undefined);

      await expect(service.refresh(RAW)).rejects.toThrow(
        'Refresh token reuse detected',
      );
      expect(revokeSpy).toHaveBeenCalledWith('fam-1');
    });

    it('sau rotation, user không còn (deleted) → 401 "Invalid or expired refresh token"', async () => {
      const existing = {
        tokenHash,
        familyId: 'fam-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 10000),
        userId: USER_ID,
      };
      refreshTokenModel.findOne.mockReturnValue(chainable(existing));
      refreshTokenModel.findOneAndUpdate.mockReturnValue(chainable(existing));
      refreshTokenModel.create.mockResolvedValue({});
      userModel.findOne.mockReturnValue(chainable(null));

      await expect(service.refresh(RAW)).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });
  });

  describe('logout (mục 16.1 — idempotent)', () => {
    it('thiếu token → no-op, KHÔNG gọi updateOne', async () => {
      await service.logout(undefined);
      expect(refreshTokenModel.updateOne).not.toHaveBeenCalled();
    });

    it('có token → updateOne mark isRevoked=true (không xoá để giữ audit trail)', async () => {
      const chain = chainable({ modifiedCount: 1 });
      refreshTokenModel.updateOne.mockReturnValue(chain);

      await service.logout('some-token');

      expect(refreshTokenModel.updateOne).toHaveBeenCalledWith(
        { tokenHash: expect.any(String) },
        { $set: { isRevoked: true } },
      );
    });

    it('token không tồn tại trong DB → KHÔNG throw (idempotent)', async () => {
      const chain = chainable({ modifiedCount: 0 });
      refreshTokenModel.updateOne.mockReturnValue(chain);

      await expect(service.logout('unknown')).resolves.toBeUndefined();
    });
  });

  describe('revokeFamily (mục 16.1)', () => {
    it('updateMany theo familyId, không throw nếu không khớp', async () => {
      const chain = chainable({ modifiedCount: 0 });
      refreshTokenModel.updateMany.mockReturnValue(chain);

      await expect(service.revokeFamily('fam-1')).resolves.toBeUndefined();
      expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
        { familyId: 'fam-1' },
        { $set: { isRevoked: true } },
      );
    });
  });

  describe('seedAdmin — 5 edge cases (mục 16.9 / 7.4.1)', () => {
    beforeEach(() => {
      // Mặc định: dev env, có đủ env.
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'ADMIN_EMAIL') return 'admin@example.com';
        if (key === 'ADMIN_PASSWORD') return 'Admin@123456';
        if (key === 'ADMIN_DISPLAY_NAME') return 'System Admin';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        return undefined;
      });
    });

    it('case 1: users rỗng + dev + có env → tạo 1 admin, argon2.hash gọi 1 lần', async () => {
      userModel.countDocuments.mockReturnValue(chainable(0));
      userModel.create.mockResolvedValue({});

      await service.seedAdmin();

      expect(argon2.hash).toHaveBeenCalledTimes(1);
      expect(argon2.hash).toHaveBeenCalledWith('Admin@123456');
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@example.com',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        }),
      );
      // Log thông báo seed thành công.
      expect(logger.log).toHaveBeenCalled();
    });

    it('case 2: users đã có 1 user (kể cả BLOCKED) → SKIP, argon2.hash KHÔNG gọi', async () => {
      userModel.countDocuments.mockReturnValue(chainable(1));

      await service.seedAdmin();

      expect(argon2.hash).not.toHaveBeenCalled();
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('case 3: NODE_ENV=test → SKIP hoàn toàn (không count, không hash)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'ADMIN_EMAIL') return 'admin@example.com';
        if (key === 'ADMIN_PASSWORD') return 'Admin@123456';
        return undefined;
      });

      await service.seedAdmin();

      expect(userModel.countDocuments).not.toHaveBeenCalled();
      expect(argon2.hash).not.toHaveBeenCalled();
    });

    it('case 4: production + thiếu ADMIN_PASSWORD → throw (app không boot)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_EMAIL') return 'admin@example.com';
        if (key === 'ADMIN_PASSWORD') return undefined; // thiếu
        return undefined;
      });
      userModel.countDocuments.mockReturnValue(chainable(0));

      await expect(service.seedAdmin()).rejects.toThrow(
        'ADMIN_EMAIL/ADMIN_PASSWORD must be set in production',
      );
      expect(argon2.hash).not.toHaveBeenCalled();
    });

    it('case 5: dev + thiếu env → dùng default + logger.warn gọi 1 lần', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'ADMIN_EMAIL') return undefined; // thiếu
        if (key === 'ADMIN_PASSWORD') return undefined; // thiếu
        if (key === 'ADMIN_DISPLAY_NAME') return undefined;
        return undefined;
      });
      userModel.countDocuments.mockReturnValue(chainable(0));
      userModel.create.mockResolvedValue({});

      await service.seedAdmin();

      // Dùng default credentials.
      expect(argon2.hash).toHaveBeenCalledWith('Admin@123456');
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@example.com',
          displayName: 'System Admin',
        }),
      );
      // Cảnh báo qua CustomLogger.warn (KHÔNG dùng console.warn — chuẩn skill).
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Using default admin credentials — change before production',
      );
    });

    it('argon2 hash fail → throw (app crash sớm, không boot không admin)', async () => {
      userModel.countDocuments.mockReturnValue(chainable(0));
      (argon2.hash as jest.Mock).mockRejectedValue(new Error('no entropy'));

      await expect(service.seedAdmin()).rejects.toThrow(
        /Failed to hash admin password during seed/,
      );
    });
  });
});
