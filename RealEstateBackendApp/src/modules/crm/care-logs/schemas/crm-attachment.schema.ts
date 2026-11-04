import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ATTACHMENT_ORIGINAL_NAME_MAX_LENGTH,
  AttachmentKind,
  AttachmentStatus,
} from '../care-log.constants';

/**
 * Ảnh đính kèm nhật ký (`crm_attachments`, tài liệu 04 mục 3.5).
 * Vòng đời: upload (READY) -> gắn vào nhật ký (ATTACHED, có `careLogId`) -> gỡ (REMOVED). Ảnh chưa gắn quá 24 giờ
 * bị dọn (REMOVED) bởi `AttachmentCleanupService`; `purgedAt` ghi lúc file thật đã bị xóa khỏi kho lưu trữ.
 * `fileKey` là UUID do hệ thống sinh; `originalName` CHỈ để hiển thị (không bao giờ dùng làm tên file).
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'crm_attachments',
})
export class CrmAttachment {
  @Prop({ type: Types.ObjectId, required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  careLogId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, required: true })
  uploaderId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(AttachmentKind),
    default: AttachmentKind.CARE_LOG_IMAGE,
  })
  kind: AttachmentKind;

  @Prop({ required: true })
  fileKey: string;

  @Prop({ type: String, default: null })
  thumbKey: string | null;

  @Prop({
    type: String,
    default: '',
    maxlength: ATTACHMENT_ORIGINAL_NAME_MAX_LENGTH,
  })
  originalName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Number, default: null })
  width: number | null;

  @Prop({ type: Number, default: null })
  height: number | null;

  @Prop({
    type: String,
    enum: Object.values(AttachmentStatus),
    default: AttachmentStatus.READY,
  })
  status: AttachmentStatus;

  @Prop({ type: Date, default: null })
  removedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  removedBy: Types.ObjectId | null;

  /** Đã xóa file khỏi kho lưu trữ lúc nào (null = chưa xóa). */
  @Prop({ type: Date, default: null })
  purgedAt: Date | null;

  createdAt: Date;
}

export type CrmAttachmentDocument = HydratedDocument<CrmAttachment>;

export const CrmAttachmentSchema = SchemaFactory.createForClass(CrmAttachment);

CrmAttachmentSchema.index({ customerId: 1, createdAt: -1 });
CrmAttachmentSchema.index({ careLogId: 1 }, { sparse: true });
// Dọn ảnh mồ côi (READY > 24 giờ) và purge file của ảnh REMOVED.
CrmAttachmentSchema.index({ status: 1, createdAt: 1 });
