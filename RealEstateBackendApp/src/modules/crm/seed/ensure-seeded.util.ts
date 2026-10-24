import { Model } from 'mongoose';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';

/**
 * Chèn bản ghi mẫu đúng MỘT lần, nhận diện bằng `seedKey` bất biến (không phải tên/mã người dùng sửa được):
 * 1. Đã có bản ghi mang `seedKey` này (kể cả đã đổi tên/mã hay xóa mềm) => bỏ qua.
 * 2. Dữ liệu seed từ TRƯỚC khi có `seedKey`: ghép theo khóa tự nhiên cũ (`naturalKey`: code / cha+tên /
 *    mã dự án), gắn bổ sung `seedKey` rồi bỏ qua — không tạo trùng.
 * 3. Chưa có gì => upsert `$setOnInsert` (an toàn khi nhiều instance khởi động cùng lúc).
 * Trả `true` khi vừa chèn mới; lỗi trùng khóa do race với instance khác coi như "đã có".
 */
export const ensureSeeded = async <T>(
  model: Model<T>,
  seedKey: string,
  naturalKey: Record<string, unknown>,
  doc: Record<string, unknown>,
): Promise<boolean> => {
  if (await model.exists({ seedKey } as never).exec()) return false;

  const legacy = await model
    .findOne(naturalKey as never)
    .select('_id')
    .lean()
    .exec();
  if (legacy) {
    await model
      .updateOne(
        {
          _id: legacy._id,
          seedKey: { $exists: false },
        },
        { $set: { seedKey } },
      )
      .exec();
    return false;
  }

  try {
    const result = await model
      .updateOne(
        { seedKey } as never,
        { $setOnInsert: { ...naturalKey, ...doc, seedKey } },
        { upsert: true },
      )
      .exec();
    return result.upsertedCount === 1;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
};
