import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ListGroup } from '../catalog.enums';

/**
 * Tình trạng khách (`customer_statuses`, tài liệu 04 mục 3.3).
 * Mỗi tình trạng thuộc đúng một `listGroup` => đổi tình trạng là đổi danh sách hiển thị của khách.
 *
 * - `code` bất biến, duy nhất kể cả bản đã xóa mềm.
 * - Đúng MỘT tình trạng `isDefault` (thuộc nhóm NOT_CONTACTED) — service giữ bất biến này.
 * - `isSystem`: 4 tình trạng seed, không xóa, không đổi nhóm.
 */
@Schema({ timestamps: true, collection: 'customer_statuses' })
export class CustomerStatus {
  @Prop({ required: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  label: string;

  @Prop({ type: String, enum: Object.values(ListGroup), required: true })
  listGroup: ListGroup;

  /** Token màu (vd `gray`, `success`) hoặc mã hex — frontend quyết định cách hiển thị. */
  @Prop({ type: String, default: null, maxlength: 30 })
  color: string | null;

  @Prop({ default: 0 })
  order: number;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: false })
  isSystem: boolean;

  @Prop({ default: true })
  isActive: boolean;

  /**
   * Khóa bất biến của bản ghi do SEED tạo (vd `STATUS:NET`, `PROJECT:QTERRA`). Seed đối chiếu theo khóa này nên
   * Quản trị đổi tên/mã bản ghi mẫu cũng không bị seed tạo lại bản trùng. Bản ghi do người dùng tạo không có.
   */
  @Prop({ type: String })
  seedKey?: string;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CustomerStatusDocument = HydratedDocument<CustomerStatus>;

export const CustomerStatusSchema =
  SchemaFactory.createForClass(CustomerStatus);

CustomerStatusSchema.index({ code: 1 }, { unique: true });
CustomerStatusSchema.index({ listGroup: 1, order: 1 });
// Khóa seed duy nhất (chỉ áp cho bản ghi có seedKey dạng chuỗi).
CustomerStatusSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } },
);
