import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

/**
 * Schema User — tài khoản quản trị (ADMIN/EDITOR).
 *
 * Bảo mật:
 * - `password` select:false (hash argon2) — KHÔNG trả ra API mặc định,
 *   service login dùng `.select('+password')` khi cần verify.
 * - `email` lowercase, unique compound với `deletedAt` để hỗ trợ soft delete
 *     (cùng email có thể tồn tại nếu bản cũ đã soft-delete).
 * - `deletedAt` null → chưa bị soft delete.
 */
@Schema({ timestamps: true })
export class User extends Document {
  @Prop({
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({ required: true })
  displayName: string;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.EDITOR,
  })
  role: UserRole;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    index: true,
  })
  status: UserStatus;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

// Unique compound { email, deletedAt } — hỗ trợ soft delete:
// cùng email chỉ duy nhất trong tập chưa bị xoá (deletedAt = null).
UserSchema.index(
  { email: 1, deletedAt: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
