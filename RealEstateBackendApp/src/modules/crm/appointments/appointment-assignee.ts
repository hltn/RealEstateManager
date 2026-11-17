import { Types } from 'mongoose';
import { uniqueObjectIds } from '../../../common/utils/object-id.util';

/** Phần của lịch hẹn mà việc đọc người thực hiện cần (bản ghi lean, có thể là bản ghi cũ chưa có `assigneeIds`). */
export interface AssigneeFields {
  assigneeIds?: readonly Types.ObjectId[] | null;
  /** DEPRECATED (bỏ ở v1.0.7): người thực hiện đầu tiên, vẫn ghi kép để lùi về bản BE cũ an toàn. */
  assigneeId?: Types.ObjectId | null;
}

const toObjectId = (value: Types.ObjectId | string): Types.ObjectId =>
  value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));

/**
 * MỘT hàm đọc chung danh sách người thực hiện (FR-30; Architecture 5.13.2 hàng 12): `assigneeIds ?? [assigneeId]`.
 * Giữ đúng ở "cửa sổ trước backfill" (BE mới chạy trước khi migration 012 điền `assigneeIds` cho lịch cũ) và với lịch do
 * BE cũ ghi sau khi lùi bản. `assigneeIds` rỗng (012 đã backfill bản ghi thiếu `assigneeId`) là rỗng thật, không rơi về
 * `assigneeId`. Mọi nơi chỉ ĐỌC/HIỂN THỊ phải đi qua hàm này, không đọc thẳng `assigneeId`.
 */
export const getAssigneeIds = (doc: AssigneeFields): Types.ObjectId[] => {
  if (doc.assigneeIds) return [...doc.assigneeIds];
  return doc.assigneeId ? [doc.assigneeId] : [];
};

/**
 * MỘT builder lọc theo người thực hiện (FR-30), dùng ở CHỈ HAI nơi lọc (danh sách lịch hẹn, việc hằng ngày). Nhánh thứ
 * hai phủ lịch cũ chưa có `assigneeIds`; index cũ `{ assigneeId, startAt }` còn nên nhánh đó vẫn có index. `ids` ép
 * ObjectId vì đường `aggregate` không tự ép kiểu. Mảng rỗng cho `$in` rỗng (không khớp gì); nơi gọi tự giữ điều kiện
 * "chỉ lọc khi có tham số". Kết quả có khóa `$or`: gom với điều kiện khác cũng có `$or` bằng `$and`, đừng trải chung.
 */
export const assigneeFilter = (
  userIds: Types.ObjectId | readonly Types.ObjectId[],
): {
  $or: [
    { assigneeIds: { $in: Types.ObjectId[] } },
    {
      assigneeIds: { $exists: false };
      assigneeId: { $in: Types.ObjectId[] };
    },
  ];
} => {
  const list = Array.isArray(userIds)
    ? (userIds as readonly Types.ObjectId[])
    : [userIds as Types.ObjectId];
  const ids = list.map(toObjectId);
  return {
    $or: [
      { assigneeIds: { $in: ids } },
      { assigneeIds: { $exists: false }, assigneeId: { $in: ids } },
    ],
  };
};

/**
 * MỘT hàm ghi kép cho mọi đường ghi lịch hẹn (tạo trực tiếp, tạo từ nhật ký, đổi người thực hiện): `assigneeIds` là
 * nguồn thật, `assigneeId` = phần tử đầu (deprecated, bỏ ở v1.0.7). Danh sách phải có ít nhất 1 người.
 */
export const toAssigneeWrite = (
  ids: readonly Types.ObjectId[],
): { assigneeIds: Types.ObjectId[]; assigneeId: Types.ObjectId } => {
  if (ids.length === 0) {
    throw new Error('Lịch hẹn phải có ít nhất một người thực hiện');
  }
  return { assigneeIds: [...ids], assigneeId: ids[0] };
};

/**
 * Danh sách người thực hiện được yêu cầu (FR-30): `assigneeIds` thắng `assigneeId` cũ (deprecated) khi có cả hai;
 * khử trùng giữ thứ tự; không yêu cầu gì thì `undefined` (nơi gọi áp luật mặc định).
 */
export const requestedAssigneeIds = (input: {
  assigneeIds?: readonly Types.ObjectId[] | null;
  assigneeId?: Types.ObjectId | null;
}): Types.ObjectId[] | undefined => {
  if (input.assigneeIds && input.assigneeIds.length > 0) {
    return uniqueObjectIds(input.assigneeIds);
  }
  return input.assigneeId ? [input.assigneeId] : undefined;
};
