import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CARE_LOG_CONTENT_MAX_LENGTH,
  CARE_LOG_SUGGESTION_MAX_LENGTH,
  CareLogSource,
  ContactChannel,
} from '../care-log.constants';

/** Việc làm tiếp theo gợi ý trong nhật ký. `appointmentId` do M5 (lịch hẹn) điền. */
@Schema({ _id: false })
export class CareLogNextAction {
  @Prop({
    type: String,
    default: null,
    maxlength: CARE_LOG_SUGGESTION_MAX_LENGTH,
  })
  suggestion: string | null;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  appointmentId: Types.ObjectId | null;
}
const CareLogNextActionSchema = SchemaFactory.createForClass(CareLogNextAction);

/** Ảnh gắn trong nhật ký (bản chụp từ `crm_attachments` lúc gắn). */
@Schema({ _id: false })
export class CareLogAttachment {
  @Prop({ type: Types.ObjectId, required: true })
  attachmentId: Types.ObjectId;

  @Prop({ required: true })
  fileKey: string;

  @Prop({ type: String, default: null })
  thumbKey: string | null;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Number, default: null })
  width: number | null;

  @Prop({ type: Number, default: null })
  height: number | null;
}
const CareLogAttachmentSchema = SchemaFactory.createForClass(CareLogAttachment);

/**
 * Nhật ký chăm sóc (`care_logs`, tài liệu 04 mục 3.5).
 * Giữ NGUYÊN tên collection và field `contactResultId`, `deletedAt`: `CrmUsageService` (M1) đếm
 * `care_logs.contactResultId` để chặn xóa danh mục "kết quả liên hệ" đang dùng.
 * `content` và `nextAction.suggestion` là văn bản tự do (có thể chứa PII) => bị ghi đè khi ẩn danh hóa khách.
 */
@Schema({ timestamps: true, collection: 'care_logs' })
export class CareLog {
  @Prop({ type: Types.ObjectId, required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorId: Types.ObjectId;

  /** Ảnh chụp tên người viết lúc ghi (đổi tên sau này không làm lệch lịch sử). */
  @Prop({ required: true })
  authorName: string;

  @Prop({ type: Date, required: true })
  occurredAt: Date;

  @Prop({ required: true, trim: true, maxlength: CARE_LOG_CONTENT_MAX_LENGTH })
  content: string;

  @Prop({ type: String, enum: Object.values(ContactChannel), required: true })
  contactChannel: ContactChannel;

  @Prop({ type: Types.ObjectId, default: null })
  contactResultId: Types.ObjectId | null;

  @Prop({ type: CareLogNextActionSchema, default: null })
  nextAction: CareLogNextAction | null;

  @Prop({ type: [CareLogAttachmentSchema], default: [] })
  attachments: CareLogAttachment[];

  @Prop({
    type: String,
    enum: Object.values(CareLogSource),
    default: CareLogSource.MANUAL,
  })
  source: CareLogSource;

  @Prop({ type: Date, default: null })
  editedAt: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  deletedBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CareLogDocument = HydratedDocument<CareLog>;

export const CareLogSchema = SchemaFactory.createForClass(CareLog);

// Dòng thời gian của một khách (chỉ nhật ký chưa xóa).
CareLogSchema.index(
  { customerId: 1, occurredAt: -1 },
  { partialFilterExpression: { deletedAt: null } },
);
CareLogSchema.index({ authorId: 1, occurredAt: -1 });
// Đếm theo kết quả liên hệ (CrmUsageService).
CareLogSchema.index({ contactResultId: 1 }, { sparse: true });
