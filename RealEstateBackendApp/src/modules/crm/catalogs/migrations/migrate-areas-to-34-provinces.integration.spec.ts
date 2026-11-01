/**
 * INTEGRATION — migration 006 (khu vực -> 34 tỉnh/thành) trên MongoDB Replica Set thật (mongodb-memory-server).
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../../../shared/database/memory-replset.util';
import { provinceSeedKey, SEED_PROVINCES } from '../../seed/crm-seed.data';
import { migrateAreasTo34Provinces } from './migrate-areas-to-34-provinces';

jest.setTimeout(240_000);

const OLD_DATE = new Date('2026-01-01T00:00:00.000Z');

describe('migrateAreasTo34Provinces', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    client = new MongoClient(replSet.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  let nextOrder = 100;
  const area = (
    name: string,
    nameNormalized: string,
    extra: Record<string, unknown> = {},
  ) => ({
    _id: new ObjectId(),
    name,
    nameNormalized,
    type: 'PROVINCE',
    parentId: null,
    ancestorIds: [],
    adminCode: null,
    isLegacy: false,
    order: (nextOrder += 1),
    isActive: true,
    deletedAt: null,
    ...extra,
  });

  /** Dữ liệu CŨ: cây 4 tỉnh + quận/huyện + "Nước ngoài" + 1 tỉnh xóa mềm + 1 tỉnh Quản trị tự tạo (thiếu seedKey, lệch type). */
  const seedOldData = async (db: ReturnType<MongoClient['db']>) => {
    const hcm = area('TP. Hồ Chí Minh', 'tp. ho chi minh', {
      seedKey: 'AREA:tp. ho chi minh',
      order: 1,
    });
    const quan7 = area('Quận 7', 'quan 7', {
      type: 'DISTRICT',
      parentId: hcm._id,
      ancestorIds: [hcm._id],
      seedKey: 'AREA:tp. ho chi minh/quan 7',
    });
    const binhDuong = area('Bình Dương', 'binh duong', {
      seedKey: 'AREA:binh duong',
    });
    const nuocNgoai = area('Nước ngoài', 'nuoc ngoai', {
      type: 'OTHER',
      seedKey: 'AREA:nuoc ngoai',
    });
    const canThoDeleted = area('Cần Thơ', 'can tho', {
      seedKey: 'AREA:can tho',
      deletedAt: OLD_DATE,
    });
    const daNangByAdmin = area('Đà Nẵng', 'da nang', {
      type: 'OTHER',
      order: 99,
    });
    await db
      .collection('areas')
      .insertMany([
        hcm,
        quan7,
        binhDuong,
        nuocNgoai,
        canThoDeleted,
        daNangByAdmin,
      ]);

    const customer = (areaId: ObjectId | null, extra = {}) => ({
      _id: new ObjectId(),
      areaId,
      version: 3,
      updatedAt: OLD_DATE,
      deletedAt: null,
      ...extra,
    });
    const customers = {
      keepHcm: customer(hcm._id),
      keepDaNang: customer(daNangByAdmin._id),
      noArea: customer(null),
      inDistrict: customer(quan7._id),
      inAbroad: customer(nuocNgoai._id),
      inOldProvince: customer(binhDuong._id, { deletedAt: OLD_DATE }),
      dangling: customer(new ObjectId()),
    };
    await db.collection('customers').insertMany(Object.values(customers));
    const projects = {
      keepHcm: { _id: new ObjectId(), areaId: hcm._id, deletedAt: null },
      inDistrict: { _id: new ObjectId(), areaId: quan7._id, deletedAt: null },
    };
    await db.collection('projects').insertMany(Object.values(projects));
    return { hcm, daNangByAdmin, customers, projects };
  };

  it('dry-run chỉ đếm; apply: khách/dự án trỏ khu vực cũ => null, xóa khu vực cũ, đủ 34 tỉnh; chạy lại không đổi gì', async () => {
    const db = client.db('mig006_main');
    const old = await seedOldData(db);
    const areas = db.collection('areas');
    const customers = db.collection('customers');
    const snapshot = async () => ({
      areas: await areas.find({}).sort({ _id: 1 }).toArray(),
      customers: await customers.find({}).sort({ _id: 1 }).toArray(),
      projects: await db
        .collection('projects')
        .find({})
        .sort({ _id: 1 })
        .toArray(),
    });

    const before = await snapshot();
    const dry = await migrateAreasTo34Provinces(db, false);
    expect(dry).toEqual({
      customersCleared: 4, // quận 7, nước ngoài, Bình Dương (đã xóa mềm), id mồ côi
      projectsCleared: 1,
      areasDeleted: 4, // Quận 7, Bình Dương, Nước ngoài, Cần Thơ (xóa mềm)
      provincesKept: 2, // TP.HCM, Đà Nẵng
      provincesInserted: 32,
      provincesNormalized: 2, // TP.HCM lệch order; Đà Nẵng lệch type/order/seedKey
    });
    expect(await snapshot()).toEqual(before);

    const applied = await migrateAreasTo34Provinces(db, true);
    expect(applied).toEqual(dry);

    // Đúng 34 tỉnh, phẳng, đúng thứ tự, không còn khu vực cũ; seedKey trùng khóa seed của ứng dụng.
    const provinces = await areas.find({}).sort({ order: 1 }).toArray();
    expect(provinces.map((p) => p.name)).toEqual([...SEED_PROVINCES]);
    expect(provinces).toHaveLength(34);
    expect(
      provinces.every(
        (p) =>
          p.type === 'PROVINCE' &&
          p.parentId === null &&
          p.ancestorIds.length === 0 &&
          p.isLegacy === false &&
          p.deletedAt === null,
      ),
    ).toBe(true);
    expect(provinces.map((p) => p.seedKey)).toEqual(
      SEED_PROVINCES.map(provinceSeedKey),
    );
    expect(provinces.map((p) => p.order)).toEqual(
      SEED_PROVINCES.map((_, index) => index + 1),
    );

    // Tỉnh trùng tên được giữ nguyên id => khách trỏ vào vẫn hợp lệ.
    const hcmAfter = provinces.find((p) => p.name === 'TP. Hồ Chí Minh');
    expect(hcmAfter?._id.equals(old.hcm._id)).toBe(true);
    expect(
      provinces
        .find((p) => p.name === 'Đà Nẵng')
        ?._id.equals(old.daNangByAdmin._id),
    ).toBe(true);

    const areaOf = async (id: ObjectId) =>
      (await customers.findOne({ _id: id }))?.areaId ?? null;
    expect(String(await areaOf(old.customers.keepHcm._id))).toBe(
      String(old.hcm._id),
    );
    expect(String(await areaOf(old.customers.keepDaNang._id))).toBe(
      String(old.daNangByAdmin._id),
    );
    for (const key of [
      'noArea',
      'inDistrict',
      'inAbroad',
      'inOldProvince',
      'dangling',
    ] as const) {
      expect([key, await areaOf(old.customers[key]._id)]).toEqual([key, null]);
    }
    const projectArea = async (id: ObjectId) =>
      (await db.collection('projects').findOne({ _id: id }))?.areaId ?? null;
    expect(String(await projectArea(old.projects.keepHcm._id))).toBe(
      String(old.hcm._id),
    );
    expect(await projectArea(old.projects.inDistrict._id)).toBeNull();

    // Không có side-effect lên khách: version/updatedAt/deletedAt giữ nguyên, không sinh bản ghi nào khác.
    const cleared = await customers.findOne({
      _id: old.customers.inDistrict._id,
    });
    expect([cleared?.version, cleared?.updatedAt]).toEqual([3, OLD_DATE]);
    expect(await customers.countDocuments({})).toBe(7);
    expect(
      (await customers.findOne({ _id: old.customers.inOldProvince._id }))
        ?.deletedAt,
    ).toEqual(OLD_DATE);

    // Idempotent: chạy lại không còn gì để đổi và không đổi dữ liệu.
    const afterApply = await snapshot();
    expect(await migrateAreasTo34Provinces(db, true)).toEqual({
      customersCleared: 0,
      projectsCleared: 0,
      areasDeleted: 0,
      provincesKept: 34,
      provincesInserted: 0,
      provincesNormalized: 0,
    });
    expect(await snapshot()).toEqual(afterApply);
  });

  it('DB chưa có dữ liệu khu vực (cài mới): tạo đủ 34 tỉnh, không lỗi', async () => {
    const db = client.db('mig006_empty');
    const result = await migrateAreasTo34Provinces(db, true);
    expect(result).toMatchObject({
      customersCleared: 0,
      projectsCleared: 0,
      areasDeleted: 0,
      provincesKept: 0,
      provincesInserted: 34,
    });
    expect(await db.collection('areas').countDocuments({})).toBe(34);
  });

  it('lỗi giữa chừng => rollback toàn bộ (khách chưa bị bỏ khu vực, khu vực cũ chưa bị xóa)', async () => {
    const db = client.db('mig006_rollback');
    const old = await seedOldData(db);
    // Ép lỗi ở bước tạo tỉnh: index duy nhất trên `order` khiến lần chèn "Hà Nội" (order 1) đụng TP.HCM (đang order 1),
    // xảy ra SAU khi khách đã bị bỏ khu vực và khu vực cũ đã bị xóa trong transaction.
    await db
      .collection('areas')
      .createIndex(
        { order: 1 },
        { unique: true, partialFilterExpression: { type: 'PROVINCE' } },
      );

    await expect(migrateAreasTo34Provinces(db, true)).rejects.toThrow();

    expect(
      String(
        (
          await db
            .collection('customers')
            .findOne({ _id: old.customers.inDistrict._id })
        )?.areaId,
      ),
    ).not.toBe('null');
    expect(await db.collection('areas').countDocuments({})).toBe(6);
  });
});
