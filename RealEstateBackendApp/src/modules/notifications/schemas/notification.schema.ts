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
 * Nội dung push đã dựng sẵn (FR-06, FR-44). Có thể chứa TÊN khách nên bị xóa cùng `title/body` khi khách bị ẩn danh
 * hóa (T-35). Không bao giờ trả ra API hộp thông báo.
 */
@Schema({ _id: false })
export class NotificationPushContent {
  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  body: string;

  /** Đường dẫn nội bộ bắt đầu bằng `/`. */
  @Prop({ type: String, required: true })
  url: string;
}
const NotificationPushContentSchema = SchemaFactory.createForClass(
  NotificationPushContent,
);

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

  /** Nội dung push dựng sẵn; `null` khi không có push (thông báo cũ hoặc `SKIPPED`). Thêm ở v1.0.4, tương thích ngược. */
  @Prop({ type: NotificationPushContentSchema, default: null })
  push: NotificationPushContent | null;

  /** Khóa gộp push hàng loạt (T-33), ví dụ `BULK:{X-Request-ID}`; `null` mặc định. */
  @Prop({ type: String, default: null })
  pushGroupKey: string | null;

  /** Mốc gửi push thành công đầu tiên. */
  @Prop({ type: Date, default: null })
  pushSentAt: Date | null;

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
// Index `{pushStatus, createdAt}` (partial PENDING) cho job quét push do migration `009` tạo, KHÔNG khai báo ở đây.
// Dọn khi khách bị ẩn danh hóa.
NotificationSchema.index({ 'data.customerId': 1 }, { sparse: true });
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_TTL_SECONDS },
);
