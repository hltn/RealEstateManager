import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Giờ yên lặng dạng `HH:mm` theo giờ Việt Nam: trong khoảng này không đẩy push (hộp thông báo vẫn nhận). */
@Schema({ _id: false })
export class QuietHours {
  @Prop({ required: true })
  start: string;

  @Prop({ required: true })
  end: string;
}
const QuietHoursSchema = SchemaFactory.createForClass(QuietHours);

/**
 * Cài đặt thông báo của một người (`notification_preferences`, tài liệu 04 mục 3.6): duy nhất theo `userId`.
 * `types` chỉ chứa loại người dùng đã đổi; loại thiếu lấy mặc định (bật cả push và hộp thông báo) nên thêm loại
 * thông báo mới không cần migration.
 */
@Schema({ timestamps: true, collection: 'notification_preferences' })
export class NotificationPreference {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  types: Record<string, { push: boolean; inApp: boolean }>;

  @Prop({ type: QuietHoursSchema, default: null })
  quietHours: QuietHours | null;

  createdAt: Date;
  updatedAt: Date;
}

export type NotificationPreferenceDocument =
  HydratedDocument<NotificationPreference>;

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreference,
);

NotificationPreferenceSchema.index({ userId: 1 }, { unique: true });
