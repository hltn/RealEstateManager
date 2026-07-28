import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import { User, UserDocument } from './schemas/user.schema';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserStatusDto } from './dtos/update-user-status.dto';
import { UpdateUserRoleDto } from './dtos/update-user-role.dto';

/** Shape trả về API (KHÔNG chứa password). */
export interface UserPublicProfile {
  _id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

function toPublic(doc: UserDocument): UserPublicProfile {
  return {
    _id: String(doc._id),
    email: doc.email,
    displayName: doc.displayName,
    role: doc.role,
    status: doc.status,
  };
}

/**
 * UsersService — CRUD tài khoản (ADMIN only).
 * Mọi query đều filter `deletedAt: null` (soft delete).
 * Password luôn hash argon2, KHÔNG trả ra API.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  /** Lấy danh sách user phân trang. */
  async findAll(page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [docs, total] = await Promise.all([
      this.userModel
        .find({ deletedAt: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.userModel.countDocuments({ deletedAt: null }).exec(),
    ]);

    return {
      data: docs.map((d) => toPublic(d as unknown as UserDocument)),
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
    const created = await this.userModel.create({
      email: dto.email.toLowerCase(),
      password: passwordHash,
      displayName: dto.displayName,
      role: dto.role,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      lastLoginAt: null,
    });

    return toPublic(created);
  }

  /** Cập nhật trạng thái (block/unblock). */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
  ): Promise<UserPublicProfile> {
    const doc = await this.userModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), deletedAt: null },
        { $set: { status: dto.status } },
        { new: true },
      )
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException('User not found');
    }
    return toPublic(doc as unknown as UserDocument);
  }

  /** Cập nhật role. */
  async updateRole(
    id: string,
    dto: UpdateUserRoleDto,
  ): Promise<UserPublicProfile> {
    const doc = await this.userModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), deletedAt: null },
        { $set: { role: dto.role } },
        { new: true },
      )
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException('User not found');
    }
    return toPublic(doc as unknown as UserDocument);
  }
}
