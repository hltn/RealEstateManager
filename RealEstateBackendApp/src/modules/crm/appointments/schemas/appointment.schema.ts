import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  APPOINTMENT_LOCATION_MAX_LENGTH,
  APPOINTMENT_NOTE_MAX_LENGTH,
  APPOINTMENT_OUTCOME_MAX_LENGTH,
  APPOINTMENT_TITLE_MAX_LENGTH,
  AppointmentStatus,
  AppointmentType,
} from '../appointment.constants';

/**
 * Lịch hẹn (`appointments`, tài liệu 04 mục 3.5). Thời điểm lưu UTC; hiển thị theo `Asia/Ho_Chi_Minh` ở client.
 *
 * - `title`, `location`, `note`, `outcome` là văn bản tự do (có thể chứa PII) => bị ghi đè khi khách bị ẩn danh hóa
 *   (`CustomerSchedulingAnonymizerService`).
 * - `assigneeId` phải thuộc `careTeam` của khách lúc gán; sau đó người này bị gỡ khỏi nhóm thì mất quyền xem lịch
 *   (phạm vi tính theo khách) và không còn nhận nhắc (QT8).
 * - `__v` là `version` cho khóa lạc quan (PATCH có thể gửi kèm `version`; lệch => 409 VERSION_CONFLICT).
 * - `sourceCareLogId`: nhật ký đã sinh ra lịch hẹn này (nextAction.appointment).
 */
@Schema({ timestamps: true, collection: 'appointments' })
export class Appointment {
  @Prop({ type: Types.ObjectId, required: true })
  customerId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AppointmentType), required: true })
  type: AppointmentType;

  @Prop({ type: String, default: '', maxlength: APPOINTMENT_TITLE_MAX_LENGTH })
  title: string;

  @Prop({ type: Date, required: true })
  startAt: Date;

  @Prop({ type: Date, default: null })
  endAt: Date | null;

  @Prop({
    type: String,
    default: '',
    maxlength: APPOINTMENT_LOCATION_MAX_LENGTH,
  })
  location: string;

  @Prop({ type: String, default: '', maxlength: APPOINTMENT_NOTE_MAX_LENGTH })
  note: string;

  @Prop({ type: Types.ObjectId, required: true })
  assigneeId: Types.ObjectId;

  /** Các mốc nhắc trước giờ hẹn (phút), giảm dần; rỗng = không nhắc. */
  @Prop({ type: [Number], default: [] })
  remindBeforeMinutes: number[];

  @Prop({
    type: String,
    enum: Object.values(AppointmentStatus),
    default: AppointmentStatus.SCHEDULED,
  })
  status: AppointmentStatus;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  completedBy: Types.ObjectId | null;

  @Prop({
    type: String,
    default: null,
    maxlength: APPOINTMENT_OUTCOME_MAX_LENGTH,
  })
  outcome: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  sourceCareLogId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, default: null })
  updatedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  deletedBy: Types.ObjectId | null;

  __v: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AppointmentDocument = HydratedDocument<Appointment>;

export const AppointmentSchema = SchemaFactory.createForClass(Appointment);

AppointmentSchema.index({ assigneeId: 1, startAt: 1 });
AppointmentSchema.index({ customerId: 1, startAt: 1 });
AppointmentSchema.index({ status: 1, startAt: 1 });
