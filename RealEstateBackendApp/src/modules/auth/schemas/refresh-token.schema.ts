import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * Schema RefreshToken — lưu hash SHA-256 của raw refresh token (opaque UUID).
 *
 * Bảo mật:
 * - `tokenHash`: KHÔNG bao giờ lưu raw token, chỉ lưu hash để tra cứu khi
 *   refresh/logout. Có index để lookup nhanh.
 * - `familyId`: nhóm các token thuộc cùng 1 phiên đăng nhập; khi phát hiện
 *   reuse (token đã revoke lại được dùng) → revoke cả family.
 * - `replacedByTokenHash`: trỏ tới token kế tiếp (audit trail rotation).
 * - `expiresAt`: TTL index (expireAfterSeconds: 0) → MongoDB tự xoá bản ghi
 *   sau khi hết hạn, không cần cron cleanup.
 */
@Schema({ timestamps: true })
export class RefreshToken extends Document {
  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  familyId: string;

  @Prop({ default: false })
  isRevoked: boolean;

  @Prop({ type: String, default: null })
  replacedByTokenHash: string | null;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

// TTL index: MongoDB tự xoá token sau khi `expiresAt` qua (expireAfterSeconds: 0).
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
