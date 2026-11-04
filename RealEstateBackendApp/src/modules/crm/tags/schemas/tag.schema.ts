import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TAG_NAME_MAX_LENGTH, TagCategory } from '../tag.constants';

/**
 * Thẻ sở thích/nghề nghiệp gắn cho khách (`tags`, tài liệu 04 mục 3.3, C11).
 *
 * - `nameNormalized` (không dấu, chữ thường) là khóa so trùng trong cùng `category`, duy nhất trong các thẻ chưa xóa.
 * - `usageCount`: số khách (kể cả khách xóa mềm) đang gắn thẻ; do `CustomerTagsService` tăng/giảm trong CÙNG
 *   transaction với việc đổi `customers.tagIds`, nên ghi vào document thẻ cũng đóng vai khóa chống gắn thẻ vừa bị
 *   xóa/gộp (xung đột ghi => chạy lại).
 * - Xóa/gộp là xóa mềm (`deletedAt`), `mergedIntoId` cho biết thẻ đã gộp vào đâu.
 */
@Schema({ timestamps: true, collection: 'tags' })
export class Tag {
  @Prop({ required: true, trim: true, maxlength: TAG_NAME_MAX_LENGTH })
  name: string;

  @Prop({ required: true })
  nameNormalized: string;

  @Prop({ type: String, enum: Object.values(TagCategory), required: true })
  category: TagCategory;

  @Prop({ type: String, default: null })
  color: string | null;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Tag', default: null })
  mergedIntoId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type TagDocument = HydratedDocument<Tag>;
export type TagLean = Tag & { _id: Types.ObjectId };

export const TagSchema = SchemaFactory.createForClass(Tag);

// Trùng tên đã chuẩn hóa trong cùng nhóm chỉ xét các thẻ chưa xóa: xóa/gộp xong có thể tạo lại thẻ cùng tên.
TagSchema.index(
  { category: 1, nameNormalized: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
TagSchema.index({ deletedAt: 1, usageCount: -1 });
