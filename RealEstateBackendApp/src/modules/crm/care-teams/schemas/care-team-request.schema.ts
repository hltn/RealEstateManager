import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CareTeamRequestStatus,
  JOIN_MESSAGE_MAX_LENGTH,
  RESOLUTION_NOTE_MAX_LENGTH,
} from '../care-team.constants';

/**
 * Đề nghị tham gia nhóm chăm sóc một khách đã có (`care_team_requests`, tài liệu 04 mục 3.5).
 * Giữ NGUYÊN tên collection và field `customerId`, `requesterId`, `status`: `CustomerPhoneService` đọc chúng
 * để trả `hasPendingRequest` cho `phone-lookups`.
 *
 * `message`/`resolutionNote` là văn bản tự do có thể nhắc tên khách => bị xóa khi ẩn danh hóa khách.
 */
@Schema({ timestamps: true, collection: 'care_team_requests' })
export class CareTeamRequest {
  @Prop({ type: Types.ObjectId, required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  requesterId: Types.ObjectId;

  @Prop({ type: String, default: null, maxlength: JOIN_MESSAGE_MAX_LENGTH })
  message: string | null;

  @Prop({
    type: String,
    enum: Object.values(CareTeamRequestStatus),
    default: CareTeamRequestStatus.PENDING,
  })
  status: CareTeamRequestStatus;

  @Prop({ type: Types.ObjectId, default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({
    type: String,
    default: null,
    maxlength: RESOLUTION_NOTE_MAX_LENGTH,
  })
  resolutionNote: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CareTeamRequestDocument = HydratedDocument<CareTeamRequest>;

export const CareTeamRequestSchema =
  SchemaFactory.createForClass(CareTeamRequest);

// Mỗi người chỉ có 1 đề nghị PENDING cho 1 khách: chống gửi trùng/race (E11000 => 409 JOIN_REQUEST_EXISTS).
CareTeamRequestSchema.index(
  { customerId: 1, requesterId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: CareTeamRequestStatus.PENDING },
  },
);
CareTeamRequestSchema.index({ status: 1, customerId: 1 });
// Hộp "mình gửi".
CareTeamRequestSchema.index({ requesterId: 1, createdAt: -1 });
