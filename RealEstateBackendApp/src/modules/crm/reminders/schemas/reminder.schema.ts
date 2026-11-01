import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  REMINDER_TTL_SECONDS,
  ReminderStatus,
  ReminderType,
} from '../reminder.constants';

/** Thông tin riêng của nhắc dịp đặc biệt (không chứa văn bản tự do của khách). */
@Schema({ _id: false })
export class ReminderPayload {
  @Prop({ type: String, default: null })
  fieldKey: string | null;

  /** Ngày xảy ra dịp (`YYYY-MM-DD`, giờ VN) mà nhắc này nói tới. */
  @Prop({ type: String, default: null })
  occurrenceDate: string | null;

  /** Nhắc trước bao nhiêu ngày (0 = đúng ngày). */
  @Prop({ type: Number, default: null })
  leadDays: number | null;
}
const ReminderPayloadSchema = SchemaFactory.createForClass(ReminderPayload);

/**
 * Nhắc việc (`reminders`, tài liệu 04 mục 3.5) — dữ liệu KỸ THUẬT, là nguồn sự thật để nhắc đúng hạn và không trùng:
 * - `dedupeKey` duy nhất: tạo lại (sửa lịch, scheduler quét lại, nhiều instance) không sinh bản thứ hai;
 * - `status`: PENDING -> PROCESSING (nhận bằng `findOneAndUpdate`, chỉ một instance thắng) -> SENT | CANCELED | FAILED;
 * - người nhận KHÔNG lấy từ `recipientIds` lúc tạo mà tính lại theo nhóm chăm sóc HIỆN TẠI khi gửi (QT8: người bị gỡ
 *   không nhận); `recipientIds` chỉ là ảnh chụp tham khảo lúc tạo;
 * - `dueAt`: mốc nghiệp vụ mà nhắc nói tới (giờ hẹn, hạn bước tiếp theo, ngày dịp) để kiểm lịch đã dời chưa.
 */
@Schema({ timestamps: true, collection: 'reminders' })
export class Reminder {
  @Prop({ type: String, enum: Object.values(ReminderType), required: true })
  type: ReminderType;

  @Prop({ type: Types.ObjectId, required: true })
  customerId: Types.ObjectId;

  /** Lịch hẹn (APPOINTMENT) hoặc nhật ký (FOLLOW_UP) mà nhắc này thuộc về. */
  @Prop({ type: Types.ObjectId, default: null })
  refId: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], default: [] })
  recipientIds: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, default: null })
  priorityRecipientId: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  fireAt: Date;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  @Prop({
    type: String,
    enum: Object.values(ReminderStatus),
    default: ReminderStatus.PENDING,
  })
  status: ReminderStatus;

  @Prop({ type: String, required: true })
  dedupeKey: string;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: Date, default: null })
  lockedAt: Date | null;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  /** Thời điểm kết thúc (SENT/CANCELED/FAILED) — mốc để TTL xóa. */
  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  @Prop({ type: ReminderPayloadSchema, default: null })
  payload: ReminderPayload | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ReminderDocument = HydratedDocument<Reminder>;

export const ReminderSchema = SchemaFactory.createForClass(Reminder);

ReminderSchema.index({ dedupeKey: 1 }, { unique: true });
// Nhận nhắc đến hạn (PENDING) và nhận lại nhắc kẹt (PROCESSING quá hạn khóa).
ReminderSchema.index({ status: 1, fireAt: 1 });
ReminderSchema.index({ status: 1, lockedAt: 1 });
// Hủy/đồng bộ theo lịch hẹn, nhật ký, khách.
ReminderSchema.index({ type: 1, refId: 1, status: 1 });
ReminderSchema.index({ customerId: 1, status: 1 });
ReminderSchema.index(
  { finishedAt: 1 },
  { expireAfterSeconds: REMINDER_TTL_SECONDS },
);
