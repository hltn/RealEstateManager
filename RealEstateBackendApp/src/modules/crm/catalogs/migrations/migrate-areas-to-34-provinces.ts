import type { Db, Document, Filter } from 'mongodb';
import { normalizeVietnamese } from '../../common/utils/vietnamese-text.util';
import { provinceSeedKey, SEED_PROVINCES } from '../../seed/crm-seed.data';
import { AreaType } from '../catalog.enums';

export interface MigrateAreasResult {
  /** Số khách (kể cả đã xóa mềm) đang trỏ khu vực cũ/không còn tồn tại => bị đặt `areaId = null`. */
  customersCleared: number;
  /** Số dự án đang trỏ khu vực cũ/không còn tồn tại => bị đặt `areaId = null`. */
  projectsCleared: number;
  /** Số bản ghi `areas` bị XÓA CỨNG (mọi bản ghi không thuộc 34 tỉnh: quận/huyện, "Nước ngoài", tỉnh cũ, bản đã xóa mềm). */
  areasDeleted: number;
  /** Số tỉnh trong 34 đã có sẵn (chưa xóa mềm, gốc, đúng tên) nên được giữ nguyên id. */
  provincesKept: number;
  /** Số tỉnh trong 34 được tạo mới. */
  provincesInserted: number;
  /** Số tỉnh được giữ lại nhưng phải chỉnh `order`/`type`/`isLegacy`/`seedKey` cho đúng chuẩn. */
  provincesNormalized: number;
}

const AREAS = 'areas';
const CUSTOMERS = 'customers';
const PROJECTS = 'projects';

/** Mô tả chuẩn của 34 tỉnh: tên, tên không dấu, khóa seed, thứ tự hiển thị. */
const buildProvinceSpecs = () =>
  SEED_PROVINCES.map((name, index) => ({
    name,
    nameNormalized: normalizeVietnamese(name),
    seedKey: provinceSeedKey(name),
    order: index + 1,
  }));

/**
 * Migration CRM — đổi khu vực sang đúng 34 tỉnh/thành (hiệu lực 01/07/2025). Dữ liệu khu vực cũ bị bỏ hẳn:
 *
 * 1. Tỉnh GIỮ LẠI = bản ghi gốc (parentId null), chưa xóa mềm, tên (không dấu) trùng một trong 34 tỉnh.
 * 2. `customers.areaId` / `projects.areaId` không trỏ vào tỉnh giữ lại (quận/huyện cũ, "Nước ngoài", tỉnh cũ,
 *    id mồ côi) => `null`. Dùng driver gốc nên KHÔNG đổi `updatedAt`/`version`, KHÔNG ghi audit từng khách,
 *    KHÔNG kích hoạt nhắc nhở hay side-effect nào.
 * 3. Xóa CỨNG mọi `areas` còn lại. Lý do không xóa mềm: không còn bản ghi nào tham chiếu; bản xóa mềm cũ vẫn giữ
 *    `seedKey` duy nhất nên sẽ chặn seed tạo lại cùng khóa, đồng thời để rác trong danh mục.
 * 4. Upsert 34 tỉnh theo `seedKey` (`AREA:<tên không dấu>`, trùng khóa seed): tỉnh trùng tên được giữ id để khách
 *    đang trỏ vào vẫn hợp lệ; thiếu thì tạo mới; đồng bộ `order`/`type`/`isLegacy`. `isActive` do Quản trị đặt được tôn trọng.
 *
 * IDEMPOTENT: chạy lại không còn gì để đổi (mọi số đếm = 0 trừ `provincesKept`).
 * `apply=false` (dry-run) chỉ đếm, không ghi. `apply=true` chạy trong MỘT transaction (cần Replica Set).
 */
export async function migrateAreasTo34Provinces(
  db: Db,
  apply: boolean,
): Promise<MigrateAreasResult> {
  const specs = buildProvinceSpecs();
  const areas = db.collection(AREAS);

  const roots = await areas
    .find({
      parentId: null,
      deletedAt: null,
      nameNormalized: { $in: specs.map((spec) => spec.nameNormalized) },
    })
    .toArray();
  const keptByName = new Map(roots.map((root) => [root.nameNormalized, root]));
  const keptIds = roots.map((root) => root._id);

  const orphanFilter: Filter<Document> = {
    areaId: { $nin: [...keptIds, null] },
  };
  const result: MigrateAreasResult = {
    customersCleared: await db
      .collection(CUSTOMERS)
      .countDocuments(orphanFilter),
    projectsCleared: await db.collection(PROJECTS).countDocuments(orphanFilter),
    areasDeleted: await areas.countDocuments({ _id: { $nin: keptIds } }),
    provincesKept: keptIds.length,
    provincesInserted: specs.length - keptByName.size,
    provincesNormalized: 0,
  };
  const toNormalize = specs.filter((spec) => {
    const kept = keptByName.get(spec.nameNormalized);
    return kept && needsNormalize(kept, spec);
  });
  result.provincesNormalized = toNormalize.length;
  if (!apply) return result;

  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const opts = { session };
      await db
        .collection(CUSTOMERS)
        .updateMany(orphanFilter, { $set: { areaId: null } }, opts);
      await db
        .collection(PROJECTS)
        .updateMany(orphanFilter, { $set: { areaId: null } }, opts);
      await areas.deleteMany({ _id: { $nin: keptIds } }, opts);

      const now = new Date();
      for (const spec of specs) {
        const kept = keptByName.get(spec.nameNormalized);
        if (!kept) {
          await areas.insertOne(
            {
              name: spec.name,
              nameNormalized: spec.nameNormalized,
              type: AreaType.PROVINCE,
              parentId: null,
              ancestorIds: [],
              adminCode: null,
              isLegacy: false,
              order: spec.order,
              treeVersion: 0,
              isActive: true,
              seedKey: spec.seedKey,
              deletedAt: null,
              createdAt: now,
              updatedAt: now,
            },
            opts,
          );
        } else if (needsNormalize(kept, spec)) {
          await areas.updateOne(
            { _id: kept._id },
            {
              $set: {
                type: AreaType.PROVINCE,
                isLegacy: false,
                order: spec.order,
                seedKey: spec.seedKey,
                updatedAt: now,
              },
            },
            opts,
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }
  return result;
}

/** Tỉnh giữ lại còn lệch chuẩn (type/isLegacy/order/seedKey) thì cần chỉnh. */
function needsNormalize(
  kept: Document,
  spec: { order: number; seedKey: string },
): boolean {
  return (
    kept.type !== AreaType.PROVINCE ||
    kept.isLegacy === true ||
    kept.order !== spec.order ||
    kept.seedKey !== spec.seedKey
  );
}
