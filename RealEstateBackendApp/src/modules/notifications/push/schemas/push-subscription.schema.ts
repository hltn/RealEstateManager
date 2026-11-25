import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  PUSH_DEVICE_LABEL_MAX_LENGTH,
  PUSH_ENDPOINT_MAX_LENGTH,
  PushPlatform,
  PushRevokedReason,
} from '../push-subscription.constants';

/** Bản mã của `auth` (cùng dạng `EncryptedPayload` của `PiiCryptoService`, AAD `${userId}:${endpointHash}:push`). */
@Schema({ _id: false })
export class PushAuthEncrypted {
  @Prop({ type: String, required: true })
  cipherText: string;

  @Prop({ type: String, required: true })
  iv: string;

  @Prop({ type: String, required: true })
  authTag: string;

  @Prop({ type: Number, required: true })
  keyVersion: number;
}
const PushAuthEncryptedSchema = SchemaFactory.createForClass(PushAuthEncrypted);

@Schema({ _id: false })
export class PushKeys {
  /** Khóa công khai của trình duyệt (base64url 87 ký tự), không bí mật. */
  @Prop({ type: String, required: true })
  p256dh: string;

  /** `auth` gốc không bao giờ lưu/ghi log/trả API: chỉ lưu bản mã (Q7). */
  @Prop({ type: PushAuthEncryptedSchema, required: true })
  authEnc: PushAuthEncrypted;
}
const PushKeysSchema = SchemaFactory.createForClass(PushKeys);

/**
 * Thiết bị nhận Web Push (`push_subscriptions`, Architecture 3.2, FR-01). Collection MỚI nên mọi index khai báo tại
 * schema (không qua migration). `endpoint` duy nhất toàn hệ thống kể cả đã thu hồi: đăng ký lại cùng endpoint là
 * upsert gán lại cho người gọi. Còn hiệu lực khi và chỉ khi `revokedAt = null`.
 */
@Schema({ timestamps: true, collection: 'push_subscriptions' })
export class PushSubscription {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  /** URL "capability" của dịch vụ push: KHÔNG ghi log thô (dùng `endpointHash`). */
  @Prop({ type: String, required: true, maxlength: PUSH_ENDPOINT_MAX_LENGTH })
  endpoint: string;

  @Prop({ type: String, required: true })
  endpointHash: string;

  @Prop({ type: PushKeysSchema, required: true })
  keys: PushKeys;

  @Prop({ type: Date, default: null })
  expirationTime: Date | null;

  @Prop({
    type: String,
    enum: Object.values(PushPlatform),
    default: PushPlatform.OTHER,
  })
  platform: PushPlatform;

  @Prop({
    type: String,
    required: true,
    maxlength: PUSH_DEVICE_LABEL_MAX_LENGTH,
  })
  deviceLabel: string;

  /** "Hoạt động": đăng ký/làm mới hoặc lần gửi thành công; dùng chọn thiết bị cũ nhất khi vượt 3 và hạn 90 ngày. */
  @Prop({ type: Date, required: true })
  lastSeenAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @Prop({
    type: String,
    enum: [...Object.values(PushRevokedReason), null],
    default: null,
  })
  revokedReason: PushRevokedReason | null;

  /** `revokedAt + 7 ngày`: TTL index tự xóa bản đã thu hồi. */
  @Prop({ type: Date, default: null })
  purgeAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type PushSubscriptionDocument = HydratedDocument<PushSubscription>;

export const PushSubscriptionSchema =
  SchemaFactory.createForClass(PushSubscription);

PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
PushSubscriptionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 });
PushSubscriptionSchema.index({ endpointHash: 1 });
// TTL: chỉ tài liệu có `purgeAt` kiểu Date mới bị xóa; `null` thì giữ.
PushSubscriptionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
