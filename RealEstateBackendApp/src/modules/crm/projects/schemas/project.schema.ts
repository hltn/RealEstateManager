import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PROJECT_CODE_MAX_LENGTH, ProjectStatus } from '../project.rules';

/**
 * Dự án bất động sản (`projects`, tài liệu 04 mục 3.3 + quy ước migration).
 *
 * - `code` giữ nguyên chữ người nhập; `codeNormalized` (chữ HOA) là khóa duy nhất KỂ CẢ dự án đã xóa mềm.
 * - `status` luôn thuộc enum; `legacyStatusText` lưu chữ gốc của dữ liệu cũ để đối chiếu (không dùng nghiệp vụ).
 * - `propertyTypes` luôn là mảng. `areaCode`/`propertyTypeCodes` ghi kép cùng `areaId`/`propertyTypes` (FR-40, FR-46).
 * - `codeNormalized` là mã tham chiếu và BẤT BIẾN sau khi tạo (PATCH chỉ đổi được hoa/thường, FR-40 Q1).
 * - `isActive=false` = ngừng hoạt động (ẩn khỏi ô chọn mới, khách cũ giữ liên kết); `deletedAt` = xóa mềm.
 */
@Schema({ timestamps: true, collection: 'projects' })
export class Project {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true, maxlength: PROJECT_CODE_MAX_LENGTH })
  code: string;

  @Prop({ required: true })
  codeNormalized: string;

  @Prop({ type: String, default: null, maxlength: 200 })
  developer: string | null;

  @Prop({ type: String, default: null, maxlength: 200 })
  location: string | null;

  @Prop({ type: Types.ObjectId, ref: 'Area', default: null })
  areaId: Types.ObjectId | null;

  /** Mã khu vực (`areas.code`), ghi kép cùng `areaId` (FR-40). Thiếu ở dữ liệu cũ đến khi migration 007 điền. */
  @Prop({ type: String, default: null, maxlength: 30 })
  areaCode: string | null;

  /** Chữ loại hình cũ (tự do) / nhãn suy ra, giữ nguyên làm dữ liệu cũ (FR-46). */
  @Prop({ type: [String], default: [] })
  propertyTypes: string[];

  /** `value` của lựa chọn trường chân dung `property_type` (FR-46); nguồn thật của loại hình. */
  @Prop({ type: [String], default: [] })
  propertyTypeCodes: string[];

  /** Chữ loại hình cũ không khớp lựa chọn nào: giữ nguyên văn để Quản trị chọn lại, không mất dữ liệu (FR-46). */
  @Prop({ type: [String], default: [] })
  unmappedPropertyTypes: string[];

  @Prop({ type: Number, default: null, min: 0 })
  priceFrom: number | null;

  @Prop({ type: Number, default: null, min: 0 })
  priceTo: number | null;

  @Prop({
    type: String,
    enum: Object.values(ProjectStatus),
    default: ProjectStatus.UPCOMING,
  })
  status: ProjectStatus;

  @Prop({ type: String, default: null })
  legacyStatusText: string | null;

  @Prop({ type: String, default: null, maxlength: 2000 })
  description: string | null;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  /**
   * Khóa bất biến của bản ghi do SEED tạo (vd `STATUS:NET`, `PROJECT:QTERRA`). Seed đối chiếu theo khóa này nên
   * Quản trị đổi tên/mã bản ghi mẫu cũng không bị seed tạo lại bản trùng. Bản ghi do người dùng tạo không có.
   */
  @Prop({ type: String })
  seedKey?: string;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<Project>;

export const ProjectSchema = SchemaFactory.createForClass(Project);

// Mã duy nhất không phân biệt hoa thường, KỂ CẢ dự án đã xóa mềm (không partial): chống race khi 2 người tạo cùng lúc.
ProjectSchema.index({ codeNormalized: 1 }, { unique: true });
// Danh sách ô chọn: dự án đang hoạt động theo tên, sort đúng thứ tự tiếng Việt.
ProjectSchema.index({ isActive: 1, name: 1 }, { collation: { locale: 'vi' } });
ProjectSchema.index({ deletedAt: 1 });
ProjectSchema.index({ areaId: 1 });
ProjectSchema.index({ areaCode: 1 });
ProjectSchema.index({ propertyTypeCodes: 1 });
// Khóa seed duy nhất (chỉ áp cho bản ghi có seedKey dạng chuỗi).
ProjectSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } },
);
