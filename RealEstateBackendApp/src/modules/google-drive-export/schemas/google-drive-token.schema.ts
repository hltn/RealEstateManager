import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * GoogleDriveToken — lưu OAuth2 token của user trên Google Drive.
 *
 * Mỗi user có tối đa 1 document (userId unique).
 * TTL index trên expiresAt tự xoá document khi token hết hạn + revoked.
 */
@Schema({ timestamps: true })
export class GoogleDriveToken extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  accessToken: string;

  @Prop({ type: String, required: true })
  refreshToken: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: null })
  scope: string | null;
}

export type GoogleDriveTokenDocument = HydratedDocument<GoogleDriveToken>;

export const GoogleDriveTokenSchema =
  SchemaFactory.createForClass(GoogleDriveToken);

// TTL index: MongoDB tự xoá document khi expiresAt < now (expireAfterSeconds: 0).
GoogleDriveTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
