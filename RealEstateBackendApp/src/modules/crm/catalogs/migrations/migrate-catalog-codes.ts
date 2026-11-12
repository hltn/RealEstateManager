import type { AnyBulkWriteOperation, Db, Document, ObjectId } from 'mongodb';
import {
  generateAreaCode,
  pickUniqueAreaCode,
} from '../../common/utils/area-code.util';
import { normalizeVietnamese } from '../../common/utils/vietnamese-text.util';
import { provinceCode, SEED_PROVINCES } from '../../seed/crm-seed.data';
import { CatalogItemType } from '../catalog.enums';

export interface MigrateCatalogCodesResult {
  /** Số khu vực chưa có `code` được điền mã (bước 1). */
  areasCoded: number;
  /** `true` nếu chỉ mục unique partial `areas.code` chưa tồn tại (đã/sẽ được tạo ở bước 1). */
  areaIndexCreated: boolean;
  /** Số dự án được điền `areaCode` (bước 3). */
  projectsAreaCoded: number;
  /** Số khách (kể cả xóa mềm) được điền `statusCode` (bước 4). */
  customersStatusCoded: number;
  /** Số khách được điền `sourceCode` (bước 4). */
  customersSourceCoded: number;
  /** Số khách được điền `areaCode` (bước 4). */
  customersAreaCoded: number;
  /** Số khách được điền `interestedProjectCodes` (bước 4). */
  customersProjectsCoded: number;
  /** Số nhật ký chăm sóc được điền `contactResultCode` (bước 5). */
  careLogsCoded: number;
  /** Số lịch hẹn được điền `projectCode` (bước 5). */
  appointmentsCoded: number;
  /** Id mồ côi dạng `collection:_id:id` (không có dữ liệu cá nhân), tối đa `MAX_ORPHANS_LISTED` dòng (bước 6). */
  orphans: string[];
}

/** Bản ghi có id nhưng id không còn trong danh mục: migration đã điền phần còn lại rồi dừng ở lỗi (bước 6). */
export class CatalogCodeOrphansError extends Error {
  constructor(
    readonly orphans: readonly string[],
    readonly result: MigrateCatalogCodesResult,
  ) {
    super(
      `Có ${orphans.length}${orphans.length >= MAX_ORPHANS_LISTED ? '+' : ''} bản ghi trỏ id không còn trong danh mục (mồ côi); ` +
        'phần còn lại đã được điền. Xử lý các bản ghi mồ côi rồi chạy lại.',
    );
    this.name = 'CatalogCodeOrphansError';
  }
}

/** Sau khi điền xong vẫn còn bản ghi thiếu `code` (image cũ ghi chen giữa): chạy lại / chạy lệnh bù là đủ. */
export class CatalogCodesIncompleteError extends Error {
  constructor(
    readonly remaining: number,
    readonly result: MigrateCatalogCodesResult,
  ) {
    super(
      `Còn ${remaining} bản ghi có id nhưng thiếu code sau khi điền (có thể do ghi đồng thời); chạy lại migration hoặc lệnh crm-catalog-codes.`,
    );
    this.name = 'CatalogCodesIncompleteError';
  }
}

const AREAS = 'areas';
const CUSTOMERS = 'customers';
const PROJECTS = 'projects';
const CARE_LOGS = 'care_logs';
const APPOINTMENTS = 'appointments';
const CUSTOMER_STATUSES = 'customer_statuses';
const CATALOG_ITEMS = 'catalog_items';

/** Kích thước lô khi duyệt khách để điền `interestedProjectCodes` và khi ghi `areas.code`. */
const BATCH_SIZE = 500;
/** Giới hạn số dòng mồ côi liệt kê (tránh phình bộ nhớ/log nếu dữ liệu hỏng diện rộng). */
const MAX_ORPHANS_LISTED = 1000;
/** Mã lỗi Mongo `NamespaceNotFound` (collection chưa tồn tại). */
const NAMESPACE_NOT_FOUND = 26;

const AREA_CODE_INDEX_NAME = 'code_1';

interface IndexSpec {
  collection: string;
  keys: Record<string, 1 | -1>;
  sparse?: boolean;
}

/**
 * Chỉ mục mới ở Architecture 3.1. Khóa + tùy chọn phải KHỚP `schema.index(...)` để `createIndex` coi là trùng định nghĩa
 * (Mongoose đặt tên mặc định giống driver) và bỏ qua thay vì báo xung đột.
 */
const NEW_INDEXES: readonly IndexSpec[] = [
  { collection: CUSTOMERS, keys: { statusCode: 1 } },
  {
    collection: CUSTOMERS,
    keys: { deletedAt: 1, statusCode: 1, lastUpdatedAt: -1 },
  },
  { collection: CUSTOMERS, keys: { primaryAssigneeId: 1, statusCode: 1 } },
  { collection: CUSTOMERS, keys: { sourceCode: 1 } },
  { collection: CUSTOMERS, keys: { areaCode: 1 } },
  { collection: CUSTOMERS, keys: { interestedProjectCodes: 1 } },
  { collection: CARE_LOGS, keys: { contactResultCode: 1 }, sparse: true },
  { collection: APPOINTMENTS, keys: { projectCode: 1, startAt: 1 } },
  { collection: PROJECTS, keys: { areaCode: 1 } },
  { collection: PROJECTS, keys: { propertyTypeCodes: 1 } },
];

/** Một cặp (id danh mục -> mã bất biến). */
interface RefEntry {
  id: ObjectId;
  code: string;
}

/** Cặp field id/code ghi kép trên một collection. */
interface RefField {
  collection: string;
  idField: string;
  codeField: string;
}

const STATUS_FIELD: RefField = {
  collection: CUSTOMERS,
  idField: 'statusId',
  codeField: 'statusCode',
};
const SOURCE_FIELD: RefField = {
  collection: CUSTOMERS,
  idField: 'sourceId',
  codeField: 'sourceCode',
};
const CUSTOMER_AREA_FIELD: RefField = {
  collection: CUSTOMERS,
  idField: 'areaId',
  codeField: 'areaCode',
};
const PROJECT_AREA_FIELD: RefField = {
  collection: PROJECTS,
  idField: 'areaId',
  codeField: 'areaCode',
};
const CONTACT_RESULT_FIELD: RefField = {
  collection: CARE_LOGS,
  idField: 'contactResultId',
  codeField: 'contactResultCode',
};
const APPOINTMENT_PROJECT_FIELD: RefField = {
  collection: APPOINTMENTS,
  idField: 'projectId',
  codeField: 'projectCode',
};

/** Có id (khác null/vắng) nhưng code vắng hoặc null. Khớp cả field vắng lẫn `null` nên là tập cha của `$exists:false`. */
const missingCodeFilter = (
  field: RefField,
  ids: readonly ObjectId[],
): Document => ({
  [field.idField]: { $in: ids },
  [field.codeField]: null,
});

/** Id không nằm trong danh mục, code vẫn thiếu: bản ghi mồ côi. */
const orphanFilter = (field: RefField, ids: readonly ObjectId[]): Document => ({
  [field.idField]: { $nin: [...ids, null] },
  [field.codeField]: null,
});

const isNamespaceNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === NAMESPACE_NOT_FOUND;

async function indexExists(
  db: Db,
  collection: string,
  name: string,
): Promise<boolean> {
  try {
    return await db.collection(collection).indexExists(name);
  } catch (error) {
    if (isNamespaceNotFound(error)) return false;
    throw error;
  }
}

/** Tên tỉnh seed theo tên không dấu: tỉnh seed luôn nhận mã `provinceCode()` xác định, không phụ thuộc thứ tự chạy. */
const SEED_PROVINCE_BY_NORMALIZED = new Map(
  SEED_PROVINCES.map((name, index) => [
    normalizeVietnamese(name),
    { name, index },
  ]),
);

/**
 * Lập kế hoạch mã cho khu vực chưa có `code` (Architecture 5.1.4), chưa ghi gì. Thứ tự xử lý xác định: tỉnh seed trước
 * (theo thứ tự danh sách seed), các khu vực khác sau (theo `_id`). Mã đã có (kể cả của bản xóa mềm) coi là đã dùng;
 * trùng thì thêm hậu tố `_2`, `_3`...
 */
function planAreaCodes(areas: readonly Document[]): Map<string, string> {
  const taken = new Set<string>();
  const uncoded: Document[] = [];
  for (const area of areas) {
    if (typeof area.code === 'string') taken.add(area.code);
    else uncoded.push(area);
  }
  const seedRank = (area: Document): number => {
    const seed =
      area.parentId === null || area.parentId === undefined
        ? SEED_PROVINCE_BY_NORMALIZED.get(String(area.nameNormalized))
        : undefined;
    return seed ? seed.index : Number.MAX_SAFE_INTEGER;
  };
  uncoded.sort((a, b) => {
    const byRank = seedRank(a) - seedRank(b);
    return byRank !== 0 ? byRank : String(a._id).localeCompare(String(b._id));
  });

  const plan = new Map<string, string>();
  for (const area of uncoded) {
    const seed =
      area.parentId === null || area.parentId === undefined
        ? SEED_PROVINCE_BY_NORMALIZED.get(String(area.nameNormalized))
        : undefined;
    const base = seed
      ? provinceCode(seed.name)
      : generateAreaCode(String(area.name));
    const code = pickUniqueAreaCode(base, taken);
    taken.add(code);
    plan.set(String(area._id), code);
  }
  return plan;
}

/** Danh mục id -> code: bỏ qua bản ghi không có `code` dạng chuỗi (không thể điền). */
function toEntries(docs: readonly Document[], codeKey: string): RefEntry[] {
  const entries: RefEntry[] = [];
  for (const doc of docs) {
    const code: unknown = doc[codeKey];
    if (typeof code === 'string' && code !== '') {
      entries.push({ id: doc._id as ObjectId, code });
    }
  }
  return entries;
}

/**
 * Điền `codeField` cho mọi bản ghi có `idField` khớp danh mục. Mỗi id một `updateMany` kèm điều kiện "code còn thiếu"
 * nên chạy lại không đổi gì. Dry-run chỉ đếm bằng một truy vấn `$in`.
 */
async function fillByRef(
  db: Db,
  field: RefField,
  entries: readonly RefEntry[],
  apply: boolean,
): Promise<number> {
  if (entries.length === 0) return 0;
  const collection = db.collection(field.collection);
  if (!apply) {
    return collection.countDocuments(
      missingCodeFilter(
        field,
        entries.map((entry) => entry.id),
      ),
    );
  }
  let total = 0;
  for (const entry of entries) {
    const result = await collection.updateMany(
      { [field.idField]: entry.id, [field.codeField]: null },
      { $set: { [field.codeField]: entry.code } },
    );
    total += result.modifiedCount;
  }
  return total;
}

/** Ghi vào `orphans` các bản ghi có id không còn trong danh mục (chỉ `collection:_id:id`). */
async function collectOrphans(
  db: Db,
  field: RefField,
  entries: readonly RefEntry[],
  orphans: string[],
): Promise<void> {
  const room = MAX_ORPHANS_LISTED - orphans.length;
  if (room <= 0) return;
  const docs = await db
    .collection(field.collection)
    .find(
      orphanFilter(
        field,
        entries.map((entry) => entry.id),
      ),
      { projection: { [field.idField]: 1 } },
    )
    .sort({ _id: 1 })
    .limit(room)
    .toArray();
  for (const doc of docs) {
    orphans.push(
      `${field.collection}:${String(doc._id)}:${String(doc[field.idField])}`,
    );
  }
}

/**
 * Điền `customers.interestedProjectCodes` từ `interestedProjectIds` theo lô 500 khách chưa có field (phân trang theo
 * `_id`, nên khách mồ côi bị bỏ lại không làm vòng lặp quay mãi). Khách có id dự án không còn trong danh mục KHÔNG bị
 * ghi (để bất biến còn nhìn thấy) mà được báo là mồ côi. Mảng id rỗng -> `[]`.
 */
async function fillInterestedProjectCodes(
  db: Db,
  projectCodeById: ReadonlyMap<string, string>,
  apply: boolean,
  orphans: string[],
): Promise<number> {
  const customers = db.collection(CUSTOMERS);
  let lastId: ObjectId | null = null;
  let coded = 0;
  for (;;) {
    const filter: Document = { interestedProjectCodes: { $exists: false } };
    if (lastId) filter._id = { $gt: lastId };
    const batch = await customers
      .find(filter, { projection: { interestedProjectIds: 1 } })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]._id;

    const operations: AnyBulkWriteOperation<Document>[] = [];
    for (const doc of batch) {
      const ids: unknown[] = Array.isArray(doc.interestedProjectIds)
        ? (doc.interestedProjectIds as unknown[])
        : [];
      const codes: string[] = [];
      let hasOrphan = false;
      for (const id of ids) {
        const code = projectCodeById.get(String(id));
        if (code === undefined) {
          hasOrphan = true;
          if (orphans.length < MAX_ORPHANS_LISTED) {
            orphans.push(`${CUSTOMERS}:${String(doc._id)}:${String(id)}`);
          }
        } else {
          codes.push(code);
        }
      }
      if (hasOrphan) continue;
      operations.push({
        updateOne: {
          filter: { _id: doc._id, interestedProjectCodes: { $exists: false } },
          update: { $set: { interestedProjectCodes: codes } },
        },
      });
    }
    if (operations.length === 0) continue;
    if (apply) {
      const result = await customers.bulkWrite(operations, { ordered: false });
      coded += result.modifiedCount;
    } else {
      coded += operations.length;
    }
  }
  return coded;
}

/** Ghi `areas.code` theo kế hoạch, từng lô, chỉ khi `code` còn thiếu (chạy lại không đổi gì). */
async function writeAreaCodes(
  db: Db,
  plan: ReadonlyMap<string, string>,
  areaIds: ReadonlyMap<string, ObjectId>,
): Promise<number> {
  const areas = db.collection(AREAS);
  const pending = [...plan.entries()];
  let written = 0;
  for (let from = 0; from < pending.length; from += BATCH_SIZE) {
    const slice = pending.slice(from, from + BATCH_SIZE);
    const result = await areas.bulkWrite(
      slice.map(([id, code]) => ({
        updateOne: {
          filter: {
            _id: areaIds.get(id) as ObjectId,
            code: { $not: { $type: 'string' } },
          },
          update: { $set: { code } },
        },
      })),
      { ordered: false },
    );
    written += result.modifiedCount;
  }
  return written;
}

/** Một lượt: đếm (apply=false) hoặc điền (apply=true) toàn bộ các bước 1..6, trả báo cáo kèm danh sách mồ côi. */
async function runOnce(
  db: Db,
  apply: boolean,
): Promise<MigrateCatalogCodesResult> {
  // Đọc danh mục: tính cả bản ngừng hoạt động và xóa mềm (khách cũ vẫn trỏ vào chúng).
  const areaDocs = await db
    .collection(AREAS)
    .find(
      {},
      { projection: { name: 1, nameNormalized: 1, parentId: 1, code: 1 } },
    )
    .toArray();
  const areaIds = new Map(areaDocs.map((doc) => [String(doc._id), doc._id]));

  // Bước 1: mã khu vực (kế hoạch luôn lập, để dry-run đếm đúng cả phần phụ thuộc mã khu vực).
  const plan = planAreaCodes(areaDocs);
  const areaIndexCreated = !(await indexExists(
    db,
    AREAS,
    AREA_CODE_INDEX_NAME,
  ));
  let areasCoded = plan.size;
  if (apply) {
    areasCoded = await writeAreaCodes(db, plan, areaIds);
    await db.collection(AREAS).createIndex(
      { code: 1 },
      {
        unique: true,
        partialFilterExpression: { code: { $type: 'string' } },
        name: AREA_CODE_INDEX_NAME,
      },
    );
  }

  // Bước 2: chỉ mục mới ở 3.1.
  if (apply) {
    for (const spec of NEW_INDEXES) {
      await db
        .collection(spec.collection)
        .createIndex(spec.keys, spec.sparse ? { sparse: true } : {});
    }
  }

  const areaEntries: RefEntry[] = areaDocs.flatMap((doc) => {
    const code =
      typeof doc.code === 'string' ? doc.code : plan.get(String(doc._id));
    return code === undefined ? [] : [{ id: doc._id, code }];
  });
  const statusEntries = toEntries(
    await db.collection(CUSTOMER_STATUSES).find({}).toArray(),
    'code',
  );
  const catalogItems = db.collection(CATALOG_ITEMS);
  const sourceEntries = toEntries(
    await catalogItems.find({ type: CatalogItemType.LEAD_SOURCE }).toArray(),
    'code',
  );
  const contactResultEntries = toEntries(
    await catalogItems.find({ type: CatalogItemType.CONTACT_RESULT }).toArray(),
    'code',
  );
  const projectEntries = toEntries(
    await db
      .collection(PROJECTS)
      .find({}, { projection: { codeNormalized: 1 } })
      .toArray(),
    'codeNormalized',
  );
  const projectCodeById = new Map(
    projectEntries.map((entry) => [String(entry.id), entry.code]),
  );

  const orphans: string[] = [];

  // Bước 3: dự án.
  const projectsAreaCoded = await fillByRef(
    db,
    PROJECT_AREA_FIELD,
    areaEntries,
    apply,
  );
  // Bước 4: khách.
  const customersStatusCoded = await fillByRef(
    db,
    STATUS_FIELD,
    statusEntries,
    apply,
  );
  const customersSourceCoded = await fillByRef(
    db,
    SOURCE_FIELD,
    sourceEntries,
    apply,
  );
  const customersAreaCoded = await fillByRef(
    db,
    CUSTOMER_AREA_FIELD,
    areaEntries,
    apply,
  );
  const customersProjectsCoded = await fillInterestedProjectCodes(
    db,
    projectCodeById,
    apply,
    orphans,
  );
  // Bước 5: nhật ký chăm sóc, lịch hẹn.
  const careLogsCoded = await fillByRef(
    db,
    CONTACT_RESULT_FIELD,
    contactResultEntries,
    apply,
  );
  const appointmentsCoded = await fillByRef(
    db,
    APPOINTMENT_PROJECT_FIELD,
    projectEntries,
    apply,
  );

  // Bước 6 (phần mồ côi): id không còn trong danh mục.
  const orphanChecks: ReadonlyArray<[RefField, readonly RefEntry[]]> = [
    [PROJECT_AREA_FIELD, areaEntries],
    [STATUS_FIELD, statusEntries],
    [SOURCE_FIELD, sourceEntries],
    [CUSTOMER_AREA_FIELD, areaEntries],
    [CONTACT_RESULT_FIELD, contactResultEntries],
    [APPOINTMENT_PROJECT_FIELD, projectEntries],
  ];
  for (const [field, entries] of orphanChecks) {
    await collectOrphans(db, field, entries, orphans);
  }

  return {
    areasCoded,
    areaIndexCreated,
    projectsAreaCoded,
    customersStatusCoded,
    customersSourceCoded,
    customersAreaCoded,
    customersProjectsCoded,
    careLogsCoded,
    appointmentsCoded,
    orphans,
  };
}

/** Tổng số bản ghi còn thiếu code (không tính chỉ mục và mồ côi). */
const countFilled = (result: MigrateCatalogCodesResult): number =>
  result.areasCoded +
  result.projectsAreaCoded +
  result.customersStatusCoded +
  result.customersSourceCoded +
  result.customersAreaCoded +
  result.customersProjectsCoded +
  result.careLogsCoded +
  result.appointmentsCoded;

const formatResult = (result: MigrateCatalogCodesResult): string =>
  [
    `areasCoded=${result.areasCoded}`,
    `areaIndexCreated=${String(result.areaIndexCreated)}`,
    `projectsAreaCoded=${result.projectsAreaCoded}`,
    `customersStatusCoded=${result.customersStatusCoded}`,
    `customersSourceCoded=${result.customersSourceCoded}`,
    `customersAreaCoded=${result.customersAreaCoded}`,
    `customersProjectsCoded=${result.customersProjectsCoded}`,
    `careLogsCoded=${result.careLogsCoded}`,
    `appointmentsCoded=${result.appointmentsCoded}`,
    `orphans=${result.orphans.length}`,
  ].join(' ');

/**
 * Migration 007 (FR-40) — điền mã bất biến `…Code` cho dữ liệu cũ, GHI KÉP cùng id (id không bị đổi hay xóa):
 *
 * 1. `areas.code` (xem `planAreaCodes`) rồi chỉ mục unique partial `{code:1}`.
 * 2. Chỉ mục mới ở Architecture 3.1.
 * 3. `projects.areaCode`  4. `customers.{statusCode,sourceCode,areaCode,interestedProjectCodes}`
 * 5. `care_logs.contactResultCode`, `appointments.projectCode`.
 * 6. Kiểm cuối: id mồ côi (id không còn trong danh mục) -> ghi `collection:_id:id` vào log rồi NÉM LỖI.
 *
 * Dùng driver gốc nên KHÔNG đổi `updatedAt`/`version`/`lastUpdatedAt`, không sinh audit, nhắc việc hay thông báo.
 * KHÔNG bọc một transaction (collection khách có thể lớn): mỗi bước idempotent theo lô nhờ điều kiện "code còn thiếu"
 * nên chạy lại từ đầu an toàn, và khi dừng vì mồ côi thì phần còn lại đã được điền sẵn.
 *
 * `apply=false` (dry-run) chỉ đếm, không ghi, không ném lỗi mồ côi (chỉ liệt kê trong kết quả).
 */
export async function migrateCatalogCodes(
  db: Db,
  apply: boolean,
  log?: (message: string) => void,
): Promise<MigrateCatalogCodesResult> {
  const result = await runOnce(db, apply);
  log?.(`${apply ? 'Đã điền' : 'Dry-run'}: ${formatResult(result)}`);
  if (!apply) return result;

  // Kiểm cuối bằng một lượt đếm: sau khi điền xong không được còn bản ghi có id mà thiếu code.
  const verify = await runOnce(db, false);
  const orphans = verify.orphans;
  if (orphans.length > 0) {
    log?.(`Bản ghi mồ côi (collection:_id:id): ${orphans.join(', ')}`);
    throw new CatalogCodeOrphansError(orphans, { ...result, orphans });
  }
  const remaining = countFilled(verify);
  if (remaining > 0) {
    throw new CatalogCodesIncompleteError(remaining, result);
  }
  return result;
}
