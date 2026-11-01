import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { highestRole } from '../../../common/utils/user-roles.util';

/**
 * Schema User — tài khoản hệ thống (ADMIN/EDITOR và, từ module CRM, MANAGER/STAFF).
 *
 * Một tài khoản có NHIỀU role (`roles`) và NHIỀU nhóm (`teamIds`). `role` và `teamId` được GIỮ làm trường SUY RA
 * luôn đồng bộ (tương thích ngược cho code/client cũ): `role` = role cao nhất, `teamId` = nhóm đầu tiên của `teamIds`.
 * Mọi đường ghi phải cập nhật cả hai cặp (pre-validate hook cuối file lo việc này cho create/save).
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

  /** Role CAO NHẤT trong `roles` (ADMIN > MANAGER > STAFF > EDITOR) — trường suy ra, luôn đồng bộ với `roles`. */
  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.EDITOR,
  })
  role: UserRole;

  /** Mọi role của tài khoản (≥1, không trùng). Quyền = hợp quyền của từng role; scope CRM theo role cao nhất. */
  @Prop({
    type: [{ type: String, enum: Object.values(UserRole) }],
    validate: {
      validator: (roles: UserRole[]) =>
        roles.length >= 1 && new Set(roles).size === roles.length,
      message: 'roles phải có ít nhất 1 role và không trùng',
    },
  })
  roles: UserRole[];

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    index: true,
  })
  status: UserStatus;

  /**
   * Nhóm làm việc CHÍNH (= `teamIds[0]`) — trường suy ra, giữ cho code cũ. `null` = chưa thuộc nhóm nào.
   * Tài khoản cũ không có field này được hiểu là `null`.
   */
  @Prop({ type: Types.ObjectId, ref: 'Team', default: null })
  teamId: Types.ObjectId | null;

  /** Mọi nhóm của người dùng (CRM, tài liệu 04 mục 3.8); chỉ tài khoản có role MANAGER/STAFF mới có nhóm. */
  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  teamIds: Types.ObjectId[];

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

// Tra thành viên của nhóm theo trạng thái (đếm thành viên, danh sách người có thể phân chăm sóc).
// `teamId` (nhóm chính) giữ cho truy vấn cũ; `teamIds` là multikey cho truy vấn theo mọi nhóm.
UserSchema.index({ teamId: 1, status: 1 });
UserSchema.index({ teamIds: 1, status: 1 });
// Tra người theo role (ADMIN đang hoạt động, danh sách người phân chăm sóc...).
UserSchema.index({ roles: 1, status: 1 });

/**
 * Giữ cặp trường suy ra luôn đồng bộ trước khi validate (create/save):
 * - `roles` rỗng (code cũ chỉ truyền `role`) → `roles = [role]`; có `roles` thì `role` = role cao nhất.
 * - `teamIds` rỗng mà có `teamId` (code cũ) → `teamIds = [teamId]`; ngược lại `teamId = teamIds[0] ?? null`.
 * Cập nhật bằng `updateOne/findOneAndUpdate` KHÔNG qua hook: nơi ghi phải tự cập nhật cả hai cặp.
 */
UserSchema.pre('validate', function () {
  if (!this.roles?.length) this.roles = [this.role];
  const primaryRole = highestRole(this.roles);
  if (primaryRole) this.role = primaryRole;

  if (!this.teamIds?.length && this.teamId) this.teamIds = [this.teamId];
  this.teamId = this.teamIds?.[0] ?? null;
});
