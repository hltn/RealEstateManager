import { Model, Types } from 'mongoose';
import { ListGroup } from '../../catalogs/catalog.enums';
import { CustomerStatusDocument } from '../../catalogs/schemas/customer-status.schema';

/** Mã bất biến và id của các tình trạng cùng một tập nhóm danh sách (hai danh sách song song, cùng độ dài). */
export interface StatusGroupRefs {
  codes: string[];
  ids: Types.ObjectId[];
}

/**
 * `code` VÀ `_id` của mọi tình trạng khách thuộc các nhóm danh sách `groups` (kể cả tình trạng đã ngừng/xóa mềm vì
 * khách cũ vẫn mang tình trạng đó). Dùng cho bộ lọc theo `customers.statusCode` của việc hôm nay, quét nhắc việc và
 * tab danh sách khách (FR-40, Architecture 5.1.2, Q3 ghi kép). Lấy cả id vì khách CHƯA được lệnh bù (backfill)
 * điền `statusCode` chỉ nhận ra được bằng `statusId`.
 */
export const findStatusRefsByGroups = async (
  statusModel: Model<CustomerStatusDocument>,
  groups: ListGroup[],
): Promise<StatusGroupRefs> => {
  const statuses = await statusModel
    .find({ listGroup: { $in: groups } })
    .select('code')
    .lean()
    .exec();
  return {
    codes: statuses.map((status) => status.code),
    ids: statuses.map((status) => status._id),
  };
};

/**
 * Điều kiện "khách thuộc tập tình trạng": theo `statusCode`, hoặc (khách chưa backfill, thiếu `statusCode`) theo
 * `statusId`. `statusCode: null` khớp cả field vắng lẫn null.
 */
export const statusInRefsCondition = (
  refs: StatusGroupRefs,
): Record<string, unknown> => ({
  $or: [
    { statusCode: { $in: refs.codes } },
    { statusCode: null, statusId: { $in: refs.ids } },
  ],
});

/**
 * Điều kiện "khách KHÔNG thuộc tập tình trạng" (phủ định đúng của `statusInRefsCondition`): `$nin` thuần theo
 * `statusCode` sẽ khớp cả khách thiếu `statusCode`, kể cả khách "Bỏ" chưa backfill, nên phải loại thêm theo `statusId`.
 */
export const statusNotInRefsCondition = (
  refs: StatusGroupRefs,
): Record<string, unknown> => ({
  $nor: [
    { statusCode: { $in: refs.codes } },
    { statusCode: null, statusId: { $in: refs.ids } },
  ],
});
