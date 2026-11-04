import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AreaType } from '../catalog.enums';

/**
 * Khu vực dạng cây (`areas`, tài liệu 04 mục 3.3).
 * - `ancestorIds`: toàn bộ tổ tiên từ gốc tới cha trực tiếp, để lọc "tỉnh gồm cả khu vực con" bằng 1 truy vấn.
 * - `nameNormalized`: tên không dấu, chữ thường — để tìm/so trùng không dấu.
 * - `isLegacy`: đơn vị hành chính cũ (sau sắp xếp 2025), mặc định ẩn khỏi danh sách chọn.
 */
@Schema({ timestamps: true, collection: 'areas' })
export class Area {
  @Prop({ required: true, trim: true, maxlength: 150 })
  name: string;

  @Prop({ required: true })
  nameNormalized: string;

  @Prop({ type: String, enum: Object.values(AreaType), required: true })
  type: AreaType;

  @Prop({ type: Types.ObjectId, ref: 'Area', default: null })
  parentId: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], default: [] })
  ancestorIds: Types.ObjectId[];

  @Prop({ type: String, default: null, maxlength: 30 })
  adminCode: string | null;

  @Prop({ default: false })
  isLegacy: boolean;

  @Prop({ default: 0 })
  order: number;

  /**
   * Bộ đếm "khóa ghi" cho thao tác chuyển cha: tăng ở khu vực cha đích và tổ tiên của nó trong transaction để
   * hai lần chuyển chéo nhau xung đột ghi (không tạo vòng cha-con do write-skew).
   */
  @Prop({ default: 0 })
  treeVersion: number;

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

export type AreaDocument = HydratedDocument<Area>;

export const AreaSchema = SchemaFactory.createForClass(Area);

AreaSchema.index({ parentId: 1, order: 1 });
AreaSchema.index({ ancestorIds: 1 });
AreaSchema.index({ nameNormalized: 1 });
// Khóa seed duy nhất (chỉ áp cho bản ghi có seedKey dạng chuỗi).
AreaSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } },
);
// Không có hai khu vực chưa xóa trùng tên (không dấu) dưới cùng một cha; chống race khi tạo/seed đồng thời.
AreaSchema.index(
  { parentId: 1, nameNormalized: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
