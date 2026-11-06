import { Types } from 'mongoose';

/** Tên cặp trường ghi kép của khách: trường `…Code` (bất biến) và trường `…Id` (cũ). */
export interface RefFieldPair {
  codeField: string;
  idField: string;
}

/** Tập mã và id (đã dịch bằng MỘT lần `resolveByCodes`) của các bản ghi danh mục được chọn. */
export interface RefSelection {
  codes: string[];
  ids: Types.ObjectId[];
}

/** Không khớp khách nào (`$in` rỗng khớp không bản ghi nào). */
const matchNothing = (field: string): Record<string, unknown> => ({
  [field]: { $in: [] },
});

/**
 * Điều kiện lọc trường ĐƠN (nguồn `sourceCode`/`sourceId`, khu vực `areaCode`/`areaId`) theo mã, kèm nhánh id song song
 * cho khách CHƯA backfill `…Code` (FR-40, Architecture 5.1.8a):
 * `{ $or: [ { code: { $in: codes } }, { code: null, id: { $in: ids } } ] }`.
 * `code: null` khớp cả trường vắng lẫn `null`, nên khách đã backfill chỉ khớp nhánh mã (không đếm lặp).
 * `ids` rỗng (mã không tồn tại) thì chỉ còn nhánh mã; `codes` rỗng thì chỉ còn nhánh id (khu vực chưa có code).
 */
export const refInCondition = (
  { codeField, idField }: RefFieldPair,
  { codes, ids }: RefSelection,
): Record<string, unknown> => {
  const branches: Record<string, unknown>[] = [];
  if (codes.length > 0) branches.push({ [codeField]: { $in: codes } });
  if (ids.length > 0) {
    branches.push({ [codeField]: null, [idField]: { $in: ids } });
  }
  if (branches.length === 0) return matchNothing(codeField);
  return branches.length === 1 ? branches[0] : { $or: branches };
};

/**
 * Như `refInCondition` nhưng cho trường MẢNG (`interestedProjectCodes`/`interestedProjectIds`). "Chưa backfill" với
 * mảng nghĩa là `…Codes` vắng, `null` hoặc rỗng (`$in: [null, []]`) mà `…Ids` có phần tử khớp. Khách đã có ít nhất một mã
 * trong `…Codes` coi là đã backfill: chỉ khớp nhánh mã, không bị nhánh id đếm lặp.
 */
export const refArrayInCondition = (
  { codeField, idField }: RefFieldPair,
  { codes, ids }: RefSelection,
): Record<string, unknown> => {
  const branches: Record<string, unknown>[] = [];
  if (codes.length > 0) branches.push({ [codeField]: { $in: codes } });
  if (ids.length > 0) {
    branches.push({
      [codeField]: { $in: [null, []] },
      [idField]: { $in: ids },
    });
  }
  if (branches.length === 0) return matchNothing(codeField);
  return branches.length === 1 ? branches[0] : { $or: branches };
};
