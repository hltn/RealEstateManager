import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Bộ đếm nguyên tử dùng chung (`counters`): `_id` là khóa nghiệp vụ (VD `CUSTOMER_CODE`),
 * `seq` là số thứ tự đã cấp lớn nhất. Chỉ cập nhật bằng `$inc` trong transaction (CounterService)
 * hoặc `$max` khi đồng bộ với dữ liệu có sẵn; doc đầu tiên do migration 010 upsert (`$setOnInsert seq: 0`).
 * Không có `timestamps`/`__v` để doc khớp đúng shape migration tạo ra.
 */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export type CounterDocument = HydratedDocument<Counter>;
export const CounterSchema = SchemaFactory.createForClass(Counter);
