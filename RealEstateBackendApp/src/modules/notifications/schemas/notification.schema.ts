import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  NOTIFICATION_TTL_SECONDS,
  NotificationPriority,
  NotificationPushStatus,
  NotificationType,
} from '../notification.constants';

/** Dữ liệu điều hướng của thông báo: KHÔNG chứa SĐT/CCCD (tài liệu 04 mục 3.6). */
@Schema({ _id: false })
export class NotificationData {
  @Prop({ type: Types.ObjectId, default: null })
  customerId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  appointmentId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  requestId: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  deepLink: string;
}
const NotificationDataSchema = SchemaFactory.createForClass(NotificationData);

/**
 * Hộp thông báo trong ứng dụng (`notifications`, tài liệu 04 mục 3.6) — dữ liệu kỹ thuật/tạm, TTL 180 ngày.
 *
 * - `title`/`body` KHÔNG chứa SĐT, CCCD; có thể có tên khách nên bị XÓA cùng khi khách bị ẩn danh hóa
 *   (`data.customerId`, xem `CustomerSchedulingAnonymizerService`).
 * - `dedupeKey` (duy nhất theo `userId`): ghi lại cùng một sự kiện (job nhắc chạy lại, retry, nhiều instance) không
 *   sinh thông báo thứ hai. Thông báo ghi thủ công không có `dedupeKey`.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'notifications',
})
export class Notification {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(NotificationType), required: true })
  type: NotificationType;

  @Prop({ required: true, maxlength: NOTIFICATION_TITLE_MAX_LENGTH })
  title: string;

  @Prop({ required: true, maxlength: NOTIFICATION_BODY_MAX_LENGTH })
  body: string;

  @Prop({ type: NotificationDataSchema, required: true })
  data: NotificationData;

  @Prop({
    type: String,
    enum: Object.values(NotificationPriority),
    default: NotificationPriority.NORMAL,
  })
  priority: NotificationPriority;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  @Prop({
    type: String,
    enum: Object.values(NotificationPushStatus),
    default: NotificationPushStatus.SKIPPED,
  })
  pushStatus: NotificationPushStatus;

  @Prop({ type: String, default: null })
  dedupeKey: string | null;

  createdAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Hộp thông báo + đếm chưa đọc.
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
// Chống trùng theo sự kiện; một phần để thông báo không có khóa (null) không đụng nhau.
NotificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
// Dọn khi khách bị ẩn danh hóa.
NotificationSchema.index({ 'data.customerId': 1 }, { sparse: true });
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_TTL_SECONDS },
);
