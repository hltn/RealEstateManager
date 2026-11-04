import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CatalogItemType } from '../catalog.enums';

/** Metadata riêng của `CONTACT_RESULT`: gợi ý mốc hẹn lại sau khi ghi nhận kết quả liên hệ (C3). */
export interface CatalogItemMeta {
  suggestedFollowUpDays: number | null;
  suggestionText: string;
}

/**
 * Danh mục phẳng dùng chung (`catalog_items`): nguồn khách (LEAD_SOURCE), kết quả liên hệ (CONTACT_RESULT),
 * nhóm trường chân dung (PERSONA_GROUP, M4). Một collection cho nhiều loại để không lặp code (DRY).
 */
@Schema({ timestamps: true, collection: 'catalog_items' })
export class CatalogItem {
  @Prop({ type: String, enum: Object.values(CatalogItemType), required: true })
  type: CatalogItemType;

  @Prop({ required: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  label: string;

  @Prop({ default: 0 })
  order: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isSystem: boolean;

  @Prop({
    type: {
      _id: false,
      suggestedFollowUpDays: { type: Number, default: null },
      suggestionText: { type: String, default: '' },
    },
    default: null,
  })
  meta: CatalogItemMeta | null;

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

export type CatalogItemDocument = HydratedDocument<CatalogItem>;

export const CatalogItemSchema = SchemaFactory.createForClass(CatalogItem);

// Mã duy nhất theo loại (kể cả bản đã xóa mềm để không tái dùng mã gây nhầm lịch sử).
CatalogItemSchema.index({ type: 1, code: 1 }, { unique: true });
CatalogItemSchema.index({ type: 1, order: 1 });
// Khóa seed duy nhất (chỉ áp cho bản ghi có seedKey dạng chuỗi).
CatalogItemSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } },
);
