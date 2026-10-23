import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CareRole,
  ConsentMethod,
  ConsentStatus,
  CreatedVia,
} from '../customer.constants';

/** Một tiêu chí đánh giá (Nhu cầu / Động cơ / Tài chính / Thời gian). */
@Schema({ _id: false })
export class CustomerCriterion {
  @Prop({ default: false })
  isDone: boolean;

  @Prop({ type: String, default: '', maxlength: 1000 })
  description: string;

  @Prop({ type: Types.ObjectId, default: null })
  updatedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  updatedAt: Date | null;
}
const CustomerCriterionSchema = SchemaFactory.createForClass(CustomerCriterion);

@Schema({ _id: false })
export class CustomerCriteria {
  @Prop({ type: CustomerCriterionSchema, default: () => ({}) })
  demand: CustomerCriterion;

  @Prop({ type: CustomerCriterionSchema, default: () => ({}) })
  motivation: CustomerCriterion;

  @Prop({ type: CustomerCriterionSchema, default: () => ({}) })
  finance: CustomerCriterion;

  @Prop({ type: CustomerCriterionSchema, default: () => ({}) })
  timing: CustomerCriterion;
}
const CustomerCriteriaSchema = SchemaFactory.createForClass(CustomerCriteria);

/** Thành viên nhóm chăm sóc (nhúng). Bất biến "đúng 1 PRIMARY" do service giữ (M3 quản lý thêm/gỡ). */
@Schema({ _id: false })
export class CareTeamEntry {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CareRole), required: true })
  role: CareRole;

  @Prop({ type: Types.ObjectId, default: null })
  addedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: () => new Date() })
  addedAt: Date;
}
const CareTeamEntrySchema = SchemaFactory.createForClass(CareTeamEntry);

@Schema({ _id: false })
export class DataConsent {
  @Prop({
    type: String,
    enum: Object.values(ConsentStatus),
    default: ConsentStatus.UNKNOWN,
  })
  status: ConsentStatus;

  @Prop({ type: String, enum: Object.values(ConsentMethod), default: null })
  method: ConsentMethod | null;

  @Prop({ type: Types.ObjectId, default: null })
  recordedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  recordedAt: Date | null;

  @Prop({ type: String, default: null, maxlength: 500 })
  note: string | null;
}
const DataConsentSchema = SchemaFactory.createForClass(DataConsent);

/** Bản mã CCCD (AES-256-GCM, aad = `${customerId}:nationalId`). */
@Schema({ _id: false })
export class NationalIdCipher {
  @Prop({ required: true })
  cipherText: string;

  @Prop({ required: true })
  iv: string;

  @Prop({ required: true })
  authTag: string;

  @Prop({ required: true })
  keyVersion: number;
}
const NationalIdCipherSchema = SchemaFactory.createForClass(NationalIdCipher);

/**
 * Khách hàng (`customers`, tài liệu 04 mục 3.2) — collection trung tâm của CRM.
 *
 * Giữ NGUYÊN tên collection và field `statusId`, `sourceId`, `areaId`, `interestedProjectIds`:
 * `CrmUsageService` đọc chúng để chặn xóa danh mục/dự án đang được dùng.
 *
 * - `phone`: E.164, duy nhất toàn hệ thống kể cả khách đã xóa mềm. KHÔNG bao giờ trả ra API list/detail.
 * - `nationalId`: `select: false`; chỉ đọc bằng `.select('+nationalId')` ở service xem CCCD.
 * - `searchText`: `select: false`, không bao giờ trả ra API.
 * - `__v`: dùng làm `version` cho khóa lạc quan (PATCH gửi kèm `version`, lệch => 409 VERSION_CONFLICT).
 * - Không có mã khách hàng (quyết định #2).
 * Các field `tagIds`, `lastCareLogAt`, `nextAppointmentAt`, `personaCompleteness` do M3–M5 ghi; M2 chỉ khai báo.
 */
@Schema({ timestamps: true, collection: 'customers' })
export class Customer {
  @Prop({ required: true, trim: true, maxlength: 150 })
  fullName: string;

  @Prop({ required: true })
  phone: string;

  @Prop({ type: String, default: null, lowercase: true, trim: true })
  email: string | null;

  @Prop({ type: Types.ObjectId, ref: 'CustomerStatus', required: true })
  statusId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  statusChangedAt: Date;

  @Prop({ type: Types.ObjectId, default: null })
  sourceId: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], default: [] })
  interestedProjectIds: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, default: null })
  areaId: Types.ObjectId | null;

  /** M4 (thẻ). */
  @Prop({ type: [Types.ObjectId], default: [] })
  tagIds: Types.ObjectId[];

  @Prop({ type: NationalIdCipherSchema, default: null, select: false })
  nationalId: NationalIdCipher | null;

  @Prop({ type: String, default: null })
  nationalIdLast4: string | null;

  @Prop({ default: false })
  hasNationalId: boolean;

  @Prop({ type: CustomerCriteriaSchema, default: () => ({}) })
  criteria: CustomerCriteria;

  /** Server tính = số tiêu chí hoàn thành x 25; không nhận từ client. */
  @Prop({ default: 0 })
  progress: number;

  @Prop({ type: [CareTeamEntrySchema], default: [] })
  careTeam: CareTeamEntry[];

  /** Phi chuẩn hóa từ `careTeam` để lọc/sort nhanh. */
  @Prop({ type: Types.ObjectId, default: null })
  primaryAssigneeId: Types.ObjectId | null;

  /** Hợp `teamId` của thành viên `careTeam` (rỗng thì = nhóm của người tạo): cơ sở phạm vi Quản lý. */
  @Prop({ type: [Types.ObjectId], default: [] })
  teamIds: Types.ObjectId[];

  /** M4. */
  @Prop({ default: 0 })
  personaCompleteness: number;

  @Prop({ type: DataConsentSchema, default: () => ({}) })
  dataConsent: DataConsent;

  @Prop({ type: Date, required: true })
  lastUpdatedAt: Date;

  @Prop({ type: Types.ObjectId, required: true })
  lastUpdatedBy: Types.ObjectId;

  /** M3. */
  @Prop({ type: Date, default: null })
  lastCareLogAt: Date | null;

  /** M5. */
  @Prop({ type: Date, default: null })
  nextAppointmentAt: Date | null;

  @Prop({ type: String, default: '', select: false })
  searchText: string;

  @Prop({
    type: String,
    enum: Object.values(CreatedVia),
    default: CreatedVia.WEB,
  })
  createdVia: CreatedVia;

  @Prop({ type: Types.ObjectId, default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  deletedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  anonymizedAt: Date | null;

  __v: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomerDocument = HydratedDocument<Customer>;

export const CustomerSchema = SchemaFactory.createForClass(Customer);

// SĐT duy nhất TOÀN HỆ THỐNG kể cả khách xóa mềm (không partial): chống race khi hai người tạo cùng lúc.
CustomerSchema.index({ phone: 1 }, { unique: true });
// Danh sách mặc định (tab Tất cả) sắp theo ngày cập nhật — phạm vi Quản trị.
CustomerSchema.index({ deletedAt: 1, lastUpdatedAt: -1 });
// Danh sách theo tình trạng/nhóm danh sách.
CustomerSchema.index({ deletedAt: 1, statusId: 1, lastUpdatedAt: -1 });
// Phạm vi Nhân viên / Quản lý.
CustomerSchema.index({
  'careTeam.userId': 1,
  deletedAt: 1,
  lastUpdatedAt: -1,
});
CustomerSchema.index({ teamIds: 1, deletedAt: 1, lastUpdatedAt: -1 });
CustomerSchema.index({ primaryAssigneeId: 1, statusId: 1 });
CustomerSchema.index({ sourceId: 1 });
CustomerSchema.index({ interestedProjectIds: 1 });
CustomerSchema.index({ areaId: 1 });
CustomerSchema.index({ progress: 1 });
CustomerSchema.index({ nextAppointmentAt: 1 });
// Sort tên đúng thứ tự tiếng Việt (query sort tên phải truyền cùng collation).
CustomerSchema.index({ fullName: 1 }, { collation: { locale: 'vi' } });
