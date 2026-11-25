import { Types } from 'mongoose';

/**
 * Khử trùng danh sách ObjectId, GIỮ thứ tự xuất hiện đầu tiên (so theo chuỗi hex). MỘT helper dùng chung thay cho các
 * bản `uniqueIds`/`uniqueObjectIds` chép lại ở từng service (DRY).
 */
export const uniqueObjectIds = (
  ids: readonly Types.ObjectId[],
): Types.ObjectId[] => [...new Map(ids.map((id) => [String(id), id])).values()];
