import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LinkedCriterion,
  PERSONA_HELP_TEXT_MAX_LENGTH,
  PERSONA_LABEL_MAX_LENGTH,
  PERSONA_OPTION_VALUE_MAX_LENGTH,
  PersonaFieldType,
} from '../persona.constants';

/** Lựa chọn của trường SELECT/MULTI_SELECT; bỏ lựa chọn = `isActive: false`, không bao giờ xóa. */
@Schema({ _id: false })
export class PersonaFieldOption {
  @Prop({
    required: true,
    trim: true,
    maxlength: PERSONA_OPTION_VALUE_MAX_LENGTH,
  })
  value: string;

  @Prop({ required: true, trim: true, maxlength: PERSONA_LABEL_MAX_LENGTH })
  label: string;

  @Prop({ default: true })
  isActive: boolean;
}
const PersonaFieldOptionSchema =
  SchemaFactory.createForClass(PersonaFieldOption);

/**
 * Cấu hình một trường chân dung (`persona_fields`, tài liệu 04 mục 3.4, X10) do Quản trị tự thêm/sửa/bớt.
 *
 * - `key` bất biến và duy nhất KỂ CẢ trường đã xóa mềm (dữ liệu khách tham chiếu theo `key`).
 * - "Bớt trường" = `isActive: false` hoặc xóa mềm (`deletedAt`): giá trị đã lưu ở `customers.persona` được GIỮ NGUYÊN,
 *   bật lại là hiện lại. Cấu hình không bao giờ xóa dữ liệu khách.
 * - `type` chỉ đổi được khi chưa khách nào có giá trị của trường (`PERSONA_FIELD_TYPE_LOCKED`).
 * - `refLock`: bộ đếm tăng mỗi khi một thao tác ghi giá trị của trường, để thao tác đổi kiểu đồng thời bị xung đột
 *   ghi và phải chạy lại (cùng cơ chế `refLock` của danh mục, tránh write-skew).
 */
@Schema({ timestamps: true, collection: 'persona_fields' })
export class PersonaField {
  @Prop({ required: true, trim: true })
  key: string;

  @Prop({ required: true, trim: true, maxlength: PERSONA_LABEL_MAX_LENGTH })
  label: string;

  @Prop({
    type: String,
    default: null,
    maxlength: PERSONA_HELP_TEXT_MAX_LENGTH,
  })
  helpText: string | null;

  @Prop({
    type: String,
    default: null,
    maxlength: PERSONA_HELP_TEXT_MAX_LENGTH,
  })
  placeholder: string | null;

  /** Mã nhóm: `catalog_items` loại PERSONA_GROUP. */
  @Prop({ required: true })
  groupCode: string;

  @Prop({
    type: String,
    enum: Object.values(PersonaFieldType),
    required: true,
  })
  type: PersonaFieldType;

  @Prop({ type: [PersonaFieldOptionSchema], default: [] })
  options: PersonaFieldOption[];

  /** Thứ tự toàn cục (nhỏ trước); trong một nhóm hiển thị theo thứ tự này. */
  @Prop({ default: 0 })
  order: number;

  /** Trọng số độ đầy đủ (C12); 0 = không tính. */
  @Prop({ default: 1, min: 0 })
  weight: number;

  /** Ưu tiên gợi ý "nên hỏi" (nhỏ = hỏi trước). */
  @Prop({ default: 50 })
  suggestPriority: number;

  @Prop({ default: false })
  isFilterable: boolean;

  @Prop({ default: false })
  isOccasion: boolean;

  @Prop({ type: String, default: null, maxlength: PERSONA_LABEL_MAX_LENGTH })
  occasionLabel: string | null;

  /** Hiển thị cạnh tiêu chí C4 tương ứng; KHÔNG tự đánh dấu hoàn thành tiêu chí. */
  @Prop({
    type: String,
    enum: [...Object.values(LinkedCriterion), null],
    default: null,
  })
  linkedCriterion: LinkedCriterion | null;

  /** Trường dễ chạm nội dung nhạy cảm: khi lưu bắt buộc `source=CUSTOMER_SHARED` + xác nhận (QT9). */
  @Prop({ default: false })
  isSensitive: boolean;

  @Prop({ default: false })
  isSystem: boolean;

  @Prop({ default: true })
  isActive: boolean;

  /** Khóa bất biến của bản ghi do SEED tạo (`PERSONA_FIELD:<key>`). */
  @Prop({ type: String })
  seedKey?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type PersonaFieldDocument = HydratedDocument<PersonaField>;
export type PersonaFieldLean = PersonaField & { _id: Types.ObjectId };

export const PersonaFieldSchema = SchemaFactory.createForClass(PersonaField);

// Khóa duy nhất kể cả trường đã xóa mềm (không partial): dữ liệu cũ của khách vẫn trỏ về `key` này.
PersonaFieldSchema.index({ key: 1 }, { unique: true });
PersonaFieldSchema.index({ isActive: 1, groupCode: 1, order: 1 });
// Khóa seed duy nhất (chỉ áp cho bản ghi có seedKey dạng chuỗi).
PersonaFieldSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } },
);
