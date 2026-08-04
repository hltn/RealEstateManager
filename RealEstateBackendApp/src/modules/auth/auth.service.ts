import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { CustomLogger } from '../../common/logger/custom-logger.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { UserStatus } from '../../common/enums/user-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { UserPublicDto } from './dtos/auth-response.dto';
import { LoginDto } from './dtos/login.dto';

/** Kết quả login/refresh — thêm `refreshToken` (raw) để controller set cookie. */
export interface LoginResult {
  accessToken: string;
  user: UserPublicDto;
  refreshToken: string;
}
export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

const DEFAULT_ADMIN_EMAIL = 'admin@example.com';
const DEFAULT_ADMIN_PASSWORD = 'Admin@123456';
const DEFAULT_ADMIN_DISPLAY_NAME = 'System Admin';

/**
 * AuthService — logic xác thực chính.
 *
 * Trách nhiệm:
 * - validateUser: verify argon2, trả doc hoặc null (không throw).
 * - login: check BLOCKED → 403, sign access token, tạo refresh token (hash lưu DB).
 * - refresh: rotation + reuse detection (CAS race), 4 nhánh theo mục 7.2.1.
 * - logout: idempotent revoke.
 * - seedAdmin: chạy onModuleInit, edge cases theo mục 7.4.1/7.5.
 *
 * Raw refresh token KHÔNG bao giờ lưu DB — chỉ lưu SHA-256 hash.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: CustomLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
  }

  /** Hash SHA-256 raw token trước khi tra cứu/lưu DB. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Parse chuỗi thời gian dạng '15m'/'7d'/'1h'/'30s'/'3600' sang ms. */
  private parseDurationToMs(value: string | undefined, fallbackMs: number): number {
    if (!value) return fallbackMs;
    const match = value.trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
    if (!match) return fallbackMs;
    const num = parseInt(match[1], 10);
    const unit = (match[2] || 's').toLowerCase();
    const multiplier =
      unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return num * multiplier;
  }

  private getRefreshExpiryMs(): number {
    const env = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN');
    // fallback 7 ngày = 7 * 86_400_000
    return this.parseDurationToMs(env, 7 * 86_400_000);
  }

  private buildUserPublic(doc: UserDocument): UserPublicDto {
    return {
      _id: String(doc._id),
      email: doc.email,
      displayName: doc.displayName,
      role: doc.role,
    };
  }

  /**
   * Verify email+password. Trả UserDocument (kèm password) hoặc null.
   * KHÔNG throw khi sai — để login quyết định exception.
   */
  async validateUser(email: string, password: string): Promise<UserDocument | null> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase(), deletedAt: null })
      .select('+password')
      .lean()
      .exec();
    if (!user) return null;
    const valid = await argon2.verify(user.password, password);
    if (!valid) return null;
    return user as unknown as UserDocument;
  }

  /**
   * Login flow (mục 7.1):
   * 1. validateUser — sai → 401 'Invalid email or password'.
   * 2. status === BLOCKED → 403 'Account is blocked'.
   * 3. sign access token, sinh refresh token (UUID), hash lưu DB.
   * 4. cập nhật lastLoginAt.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.validateUser(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('Account is blocked');
    }

    const accessToken = await this.signAccessToken(user);
    const { rawToken } = await this.issueRefreshToken(user._id, null);

    // Cập nhật lastLoginAt (fire-and-forget, không block response).
    this.userModel
      .updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } })
      .exec()
      .catch((err) => this.logger.error(`Failed to update lastLoginAt: ${String(err)}`));

    return { accessToken, user: this.buildUserPublic(user), refreshToken: rawToken };
  }

  private async signAccessToken(user: UserDocument): Promise<string> {
    const payload = {
      sub: String(user._id),
      email: user.email,
      role: user.role,
    };
    return this.jwtService.signAsync(payload);
  }

  /**
   * Tạo refresh token mới, hash lưu DB. Trả raw token để set cookie.
   * Nếu `familyId` truyền vào null → sinh familyId mới (phiên mới).
   */
  private async issueRefreshToken(
    userId: Types.ObjectId | string,
    familyId: string | null,
  ): Promise<{ rawToken: string }> {
    const rawToken = randomUUID();
    const tokenHash = this.hashToken(rawToken);
    const family = familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.getRefreshExpiryMs());

    await this.refreshTokenModel.create({
      tokenHash,
      userId: new Types.ObjectId(String(userId)),
      familyId: family,
      isRevoked: false,
      replacedByTokenHash: null,
      expiresAt,
    });

    return { rawToken };
  }

  /**
   * Refresh flow (mục 7.2.1 — 4 nhánh) + CAS race (7.2.2).
   *
   * Nhánh:
   * 1. Không tồn tại → 401 'Invalid or expired refresh token' (KHÔNG revoke).
   * 2. Hết hạn (isRevoked=false, expiresAt<now) → 401 cùng msg (KHÔNG revoke).
   * 3. isRevoked=true → reuse detected → revokeFamily + 401 'Refresh token reuse detected'.
   * 4. Hợp lệ → CAS mark old revoked (replacedByTokenHash=hash mới), tạo token
   *    mới cùng familyId, sign access token mới. Nếu CAS thua race (null) →
   *    coi như reuse → revokeFamily + 401.
   */
  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.refreshTokenModel
      .findOne({ tokenHash })
      .lean()
      .exec();

    // Nhánh 1: token không tồn tại (có thể bị TTL xoá).
    if (!existing) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Nhánh 2: hết hạn nhưng chưa revoke.
    const isExpired =
      existing.expiresAt instanceof Date &&
      existing.expiresAt.getTime() < Date.now();
    if (!existing.isRevoked && isExpired) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Nhánh 3: đã revoke → tái sử dụng token (reuse detected).
    if (existing.isRevoked) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Nhánh 4: token hợp lệ — CAS atomic rotation.
    const newRawToken = randomUUID();
    const newHash = this.hashToken(newRawToken);

    const old = await this.refreshTokenModel
      .findOneAndUpdate(
        { tokenHash, isRevoked: false }, // CAS guard
        { $set: { isRevoked: true, replacedByTokenHash: newHash } },
        { returnDocument: 'before' },
      )
      .lean()
      .exec();

    if (!old) {
      // Thua race — token đã bị request khác "vồ" trước → giờ isRevoked=true → reuse.
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Tạo token mới cùng familyId (kế thừa phiên).
    await this.refreshTokenModel.create({
      tokenHash: newHash,
      userId: existing.userId,
      familyId: existing.familyId,
      isRevoked: false,
      replacedByTokenHash: null,
      expiresAt: new Date(Date.now() + this.getRefreshExpiryMs()),
    });

    const user = await this.userModel
      .findOne({ _id: existing.userId, deletedAt: null })
      .lean()
      .exec();
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = await this.signAccessToken(user as unknown as UserDocument);
    return { accessToken, refreshToken: newRawToken };
  }

  /**
   * Logout — idempotent: token không tồn tại → no-op, không throw.
   * Chỉ mark isRevoked=true (không xoá để giữ audit trail).
   */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.refreshTokenModel
      .updateOne({ tokenHash }, { $set: { isRevoked: true } })
      .exec();
  }

  /**
   * Revoke cả family khi phát hiện reuse. updateMany trên 1 collection,
   * không cần transaction (mục 7.2.3). Không throw nếu không có token khớp.
   */
  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokenModel
      .updateMany({ familyId }, { $set: { isRevoked: true } })
      .exec();
  }

  /** Lấy profile cho /auth/me (kèm status). */
  async getMe(userId: string): Promise<{
    _id: string;
    email: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
  }> {
    const user = await this.userModel
      .findOne({ _id: new Types.ObjectId(userId), deletedAt: null })
      .lean()
      .exec();
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return {
      _id: String(user._id),
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    };
  }

  /**
   * Admin seed (mục 7.4.1 / 7.5) — chạy trong onModuleInit.
   * Thứ tự ưu tiên:
   * 1. NODE_ENV=test → skip hoàn toàn.
   * 2. Đã có user (bất kỳ status) → skip, không ghi đè.
   * 3. Production + thiếu ADMIN_EMAIL/ADMIN_PASSWORD → throw (fail-fast).
   * 4. Dev + thiếu env → dùng default + CustomLogger.warn.
   * 5. argon2 hash fail → throw (app crash sớm, không boot không admin).
   */
  async seedAdmin(): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'test') return;

    const userCount = await this.userModel.countDocuments({}).exec();
    if (userCount > 0) return;

    const email = this.configService.get<string>('ADMIN_EMAIL');
    const password = this.configService.get<string>('ADMIN_PASSWORD');
    const displayName =
      this.configService.get<string>('ADMIN_DISPLAY_NAME') ||
      DEFAULT_ADMIN_DISPLAY_NAME;

    const isProduction = nodeEnv === 'production';
    const missingCredentials = !email || !password;

    if (isProduction && missingCredentials) {
      throw new Error(
        'ADMIN_EMAIL/ADMIN_PASSWORD must be set in production',
      );
    }

    const finalEmail = email || DEFAULT_ADMIN_EMAIL;
    const finalPassword = password || DEFAULT_ADMIN_PASSWORD;

    if (missingCredentials) {
      // Dev fallback — cảnh báo qua CustomLogger (KHÔNG dùng console.warn).
      this.logger.warn(
        'Using default admin credentials — change before production',
      );
    }

    let passwordHash: string;
    try {
      passwordHash = await argon2.hash(finalPassword);
    } catch (err) {
      // Hash fail → app không nên boot với system không admin.
      throw new Error(
        `Failed to hash admin password during seed: ${String(err)}`,
      );
    }

    await this.userModel.create({
      email: finalEmail.toLowerCase(),
      password: passwordHash,
      displayName,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      lastLoginAt: null,
    });

    this.logger.log(
      `Admin account seeded (email=${finalEmail}). Change credentials before production.`,
    );
  }
}
