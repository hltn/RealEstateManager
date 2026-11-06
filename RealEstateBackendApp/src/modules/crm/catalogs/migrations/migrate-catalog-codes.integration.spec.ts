/**
 * INTEGRATION — migration 007 (điền mã bất biến `…Code`, FR-40) trên MongoDB Replica Set thật (mongodb-memory-server).
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../../../shared/database/memory-replset.util';
import { CatalogItemType } from '../catalog.enums';
import {
  CatalogCodeOrphansError,
  migrateCatalogCodes,
} from './migrate-catalog-codes';

jest.setTimeout(240_000);

const OLD_DATE = new Date('2026-01-01T00:00:00.000Z');
const COLLECTIONS = [
  'areas',
  'customer_statuses',
  'catalog_items',
  'projects',
  'customers',
  'care_logs',
  'appointments',
] as const;

describe('migrateCatalogCodes', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let dbCounter = 0;

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    client = new MongoClient(replSet.getUri());
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  const stamps = { version: 3, updatedAt: OLD_DATE, lastUpdatedAt: OLD_DATE };
  const id = () => new ObjectId();

  /** Dữ liệu CŨ (trước 007): chỉ có id, chưa có code nào ở phía tham chiếu. */
  const seedOldData = async (db: Db) => {
    const hn = {
      _id: id(),
      name: 'Hà Nội',
      nameNormalized: 'ha noi',
      parentId: null,
    };
    const hcm = {
      _id: id(),
      name: 'TP. Hồ Chí Minh',
      nameNormalized: 'tp. ho chi minh',
      parentId: null,
    };
    // Hai khu vực tự tạo cùng ra mã gốc KHU_MOI -> mã sau phải có hậu tố.
    const khuMoiA = {
      _id: id(),
      name: 'Khu Mới',
      nameNormalized: 'khu moi',
      parentId: hn._id,
    };
    const khuMoiB = {
      _id: id(),
      name: 'Khu mới!',
      nameNormalized: 'khu moi!',
      parentId: hcm._id,
    };
    // Khu vực xóa mềm đã có code: mã vẫn bị coi là đã dùng.
    const daXoa = {
      _id: id(),
      name: 'Khu cũ',
      nameNormalized: 'khu cu',
      parentId: null,
      code: 'KHU_MOI_2',
      deletedAt: OLD_DATE,
    };
    const areas = [hn, hcm, khuMoiA, khuMoiB, daXoa].map((a) => ({
      type: 'PROVINCE',
      ancestorIds: [],
      isActive: true,
      deletedAt: null,
      ...a,
      ...stamps,
    }));
    await db.collection('areas').insertMany(areas);

    const statusMoi = { _id: id(), code: 'NEW' };
    const statusNgung = { _id: id(), code: 'OLD_STATUS', isActive: false };
    await db
      .collection('customer_statuses')
      .insertMany([statusMoi, statusNgung].map((s) => ({ ...s, ...stamps })));
    const sourceFb = {
      _id: id(),
      type: CatalogItemType.LEAD_SOURCE,
      code: 'FB',
    };
    const resultNoAnswer = {
      _id: id(),
      type: CatalogItemType.CONTACT_RESULT,
      code: 'NO_ANSWER',
    };
    await db
      .collection('catalog_items')
      .insertMany([sourceFb, resultNoAnswer].map((s) => ({ ...s, ...stamps })));

    const project = { _id: id(), codeNormalized: 'QTERRA', areaId: hcm._id };
    const projectNoArea = { _id: id(), codeNormalized: 'NOAREA', areaId: null };
    await db
      .collection('projects')
      .insertMany([project, projectNoArea].map((p) => ({ ...p, ...stamps })));

    const c1 = {
      _id: id(),
      statusId: statusMoi._id,
      sourceId: sourceFb._id,
      areaId: hcm._id,
      interestedProjectIds: [project._id, projectNoArea._id],
    };
    // Khách xóa mềm, trạng thái ngừng hoạt động, không nguồn/khu vực, không dự án.
    const c2 = {
      _id: id(),
      statusId: statusNgung._id,
      sourceId: null,
      areaId: null,
      interestedProjectIds: [],
      deletedAt: OLD_DATE,
    };
    await db
      .collection('customers')
      .insertMany([c1, c2].map((c) => ({ ...c, ...stamps })));
    await db.collection('care_logs').insertMany([
      {
        _id: id(),
        customerId: c1._id,
        contactResultId: resultNoAnswer._id,
        ...stamps,
      },
      { _id: id(), customerId: c1._id, contactResultId: null, ...stamps },
    ]);
    await db.collection('appointments').insertMany([
      { _id: id(), customerId: c1._id, projectId: project._id, ...stamps },
      { _id: id(), customerId: c1._id, projectId: null, ...stamps },
    ]);
    return { hn, hcm, khuMoiA, khuMoiB, daXoa, c1, c2 };
  };

  const freshDb = (): Db => client.db(`mig007_${(dbCounter += 1)}`);

  /** Ảnh chụp toàn bộ dữ liệu (so sánh sâu) của mọi collection liên quan. */
  const snapshot = async (db: Db) => {
    const result: Record<string, unknown[]> = {};
    for (const name of COLLECTIONS) {
      result[name] = await db
        .collection(name)
        .find({})
        .sort({ _id: 1 })
        .toArray();
    }
    return result;
  };

  /** Số bản ghi có id nhưng thiếu code (bất biến 3.1; phải bằng 0 sau khi điền). */
  const countIdWithoutCode = async (db: Db): Promise<number> => {
    const checks: Array<[string, string, string]> = [
      ['projects', 'areaId', 'areaCode'],
      ['customers', 'statusId', 'statusCode'],
      ['customers', 'sourceId', 'sourceCode'],
      ['customers', 'areaId', 'areaCode'],
      ['care_logs', 'contactResultId', 'contactResultCode'],
      ['appointments', 'projectId', 'projectCode'],
    ];
    let total = 0;
    for (const [collection, idField, codeField] of checks) {
      total += await db
        .collection(collection)
        .countDocuments({ [idField]: { $ne: null }, [codeField]: null });
    }
    total += await db
      .collection('customers')
      .countDocuments({ interestedProjectCodes: { $exists: false } });
    total += await db
      .collection('areas')
      .countDocuments({ code: { $not: { $type: 'string' } } });
    return total;
  };

  const EXPECTED_COUNTS = {
    areasCoded: 4,
    projectsAreaCoded: 1,
    customersStatusCoded: 2,
    customersSourceCoded: 1,
    customersAreaCoded: 1,
    customersProjectsCoded: 2,
    careLogsCoded: 1,
    appointmentsCoded: 1,
  };

  const ZERO_COUNTS = Object.fromEntries(
    Object.keys(EXPECTED_COUNTS).map((key) => [key, 0]),
  );

  it('dry-run: đếm đúng và KHÔNG ghi gì (dữ liệu, chỉ mục giữ nguyên)', async () => {
    const db = freshDb();
    await seedOldData(db);
    const before = await snapshot(db);

    const result = await migrateCatalogCodes(db, false);

    expect(result).toMatchObject({
      ...EXPECTED_COUNTS,
      areaIndexCreated: true,
      orphans: [],
    });
    expect(await snapshot(db)).toEqual(before);
    const indexNames = (
      await db
        .collection('customers')
        .indexes()
        .catch(() => [])
    ).map((index) => index.name);
    expect(indexNames).not.toContain('statusCode_1');
    const areaIndexNames = (
      await db
        .collection('areas')
        .indexes()
        .catch(() => [])
    ).map((index) => index.name);
    expect(areaIndexNames).not.toContain('code_1');
  });

  it('đối chứng: lọc theo code bỏ sót bản ghi cũ trước khi bù, thấy đủ sau khi bù', async () => {
    const db = freshDb();
    const { c1 } = await seedOldData(db);
    const customers = db.collection('customers');

    // Trước: khách có statusId nhưng lọc theo statusCode không thấy ai.
    expect(await customers.countDocuments({ statusId: c1.statusId })).toBe(1);
    expect(await customers.countDocuments({ statusCode: 'NEW' })).toBe(0);
    expect(await customers.countDocuments({ areaCode: 'TP_HO_CHI_MINH' })).toBe(
      0,
    );

    await migrateCatalogCodes(db, true);

    expect(await customers.countDocuments({ statusCode: 'NEW' })).toBe(1);
    expect(await customers.countDocuments({ areaCode: 'TP_HO_CHI_MINH' })).toBe(
      1,
    );
    expect(
      await customers.countDocuments({ interestedProjectCodes: 'QTERRA' }),
    ).toBe(1);
  });

  it('điền đúng mã ở mọi collection (kể cả bản ngừng hoạt động/xóa mềm), mã khu vực không trùng', async () => {
    const db = freshDb();
    const { hn, hcm, khuMoiA, khuMoiB, daXoa, c1, c2 } = await seedOldData(db);

    const result = await migrateCatalogCodes(db, true);

    expect(result).toMatchObject({
      ...EXPECTED_COUNTS,
      areaIndexCreated: true,
      orphans: [],
    });
    const areaCode = async (areaId: ObjectId) =>
      (await db.collection('areas').findOne({ _id: areaId }))?.code;
    expect(await areaCode(hn._id)).toBe('HA_NOI');
    expect(await areaCode(hcm._id)).toBe('TP_HO_CHI_MINH');
    expect(await areaCode(khuMoiA._id)).toBe('KHU_MOI');
    // KHU_MOI đã bị khu vực A dùng, KHU_MOI_2 là mã của bản xóa mềm -> phải nhảy tới _3.
    expect(await areaCode(khuMoiB._id)).toBe('KHU_MOI_3');
    expect(await areaCode(daXoa._id)).toBe('KHU_MOI_2');

    const customer1 = await db.collection('customers').findOne({ _id: c1._id });
    expect(customer1).toMatchObject({
      statusCode: 'NEW',
      sourceCode: 'FB',
      areaCode: 'TP_HO_CHI_MINH',
      interestedProjectCodes: ['QTERRA', 'NOAREA'],
    });
    const customer2 = await db.collection('customers').findOne({ _id: c2._id });
    expect(customer2).toMatchObject({
      statusCode: 'OLD_STATUS',
      interestedProjectCodes: [],
    });
    expect(customer2?.sourceCode ?? null).toBeNull();
    expect(
      (await db.collection('projects').findOne({ codeNormalized: 'QTERRA' }))
        ?.areaCode,
    ).toBe('TP_HO_CHI_MINH');
    expect(
      (
        await db
          .collection('care_logs')
          .findOne({ contactResultCode: { $exists: true } })
      )?.contactResultCode,
    ).toBe('NO_ANSWER');
    expect(
      (
        await db
          .collection('appointments')
          .findOne({ projectCode: { $exists: true } })
      )?.projectCode,
    ).toBe('QTERRA');
  });

  it('chạy lần hai: mọi con số đếm bằng 0 và dữ liệu không đổi', async () => {
    const db = freshDb();
    await seedOldData(db);
    await migrateCatalogCodes(db, true);
    const afterFirst = await snapshot(db);

    const second = await migrateCatalogCodes(db, true);

    expect(second).toMatchObject({
      ...ZERO_COUNTS,
      areaIndexCreated: false,
      orphans: [],
    });
    expect(await snapshot(db)).toEqual(afterFirst);
  });

  it('không đổi updatedAt / version / lastUpdatedAt ở bất kỳ collection nào', async () => {
    const db = freshDb();
    await seedOldData(db);

    await migrateCatalogCodes(db, true);

    for (const name of COLLECTIONS) {
      const docs = await db.collection(name).find({}).toArray();
      expect(docs.length).toBeGreaterThan(0);
      for (const doc of docs) {
        expect(doc.updatedAt).toEqual(OLD_DATE);
        expect(doc.version).toBe(3);
        if (name === 'customers') expect(doc.lastUpdatedAt).toEqual(OLD_DATE);
      }
    }
  });

  it('bất biến 3.1: không còn bản ghi có id mà thiếu code; chỉ mục mới được tạo; mã khu vực duy nhất', async () => {
    const db = freshDb();
    await seedOldData(db);
    expect(await countIdWithoutCode(db)).toBeGreaterThan(0);

    await migrateCatalogCodes(db, true);

    expect(await countIdWithoutCode(db)).toBe(0);
    const names = async (collection: string) =>
      (await db.collection(collection).indexes()).map((index) => index.name);
    expect(await names('customers')).toEqual(
      expect.arrayContaining([
        'statusCode_1',
        'deletedAt_1_statusCode_1_lastUpdatedAt_-1',
        'primaryAssigneeId_1_statusCode_1',
        'sourceCode_1',
        'areaCode_1',
        'interestedProjectCodes_1',
      ]),
    );
    expect(await names('projects')).toEqual(
      expect.arrayContaining(['areaCode_1', 'propertyTypeCodes_1']),
    );
    expect(await names('appointments')).toContain('projectCode_1_startAt_1');
    expect(await names('care_logs')).toContain('contactResultCode_1');
    const areaIndex = (await db.collection('areas').indexes()).find(
      (index) => index.name === 'code_1',
    );
    expect(areaIndex).toMatchObject({
      unique: true,
      partialFilterExpression: { code: { $type: 'string' } },
    });
    await expect(
      db
        .collection('areas')
        .insertOne({ _id: id(), name: 'Trùng', code: 'HA_NOI' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('bản ghi mồ côi: ném lỗi, ghi log id (không dữ liệu cá nhân), phần còn lại ĐÃ được điền, sổ system không bị ghi', async () => {
    const db = freshDb();
    const { c1 } = await seedOldData(db);
    const ghostStatus = id();
    const ghostProject = id();
    const ghostResult = id();
    const orphanCustomer = {
      _id: id(),
      fullName: 'Nguyễn Văn Bí Mật',
      phone: '0900000000',
      statusId: ghostStatus,
      sourceId: null,
      areaId: null,
      interestedProjectIds: [ghostProject],
      ...stamps,
    };
    const orphanLog = {
      _id: id(),
      customerId: c1._id,
      contactResultId: ghostResult,
      ...stamps,
    };
    await db.collection('customers').insertOne(orphanCustomer);
    await db.collection('care_logs').insertOne(orphanLog);
    const logs: string[] = [];

    let thrown: unknown;
    try {
      await migrateCatalogCodes(db, true, (line) => logs.push(line));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CatalogCodeOrphansError);
    const orphans = (thrown as CatalogCodeOrphansError).orphans;
    expect(orphans).toEqual(
      expect.arrayContaining([
        `customers:${String(orphanCustomer._id)}:${String(ghostStatus)}`,
        `customers:${String(orphanCustomer._id)}:${String(ghostProject)}`,
        `care_logs:${String(orphanLog._id)}:${String(ghostResult)}`,
      ]),
    );
    const logText = logs.join('\n');
    expect(logText).toContain(`customers:${String(orphanCustomer._id)}`);
    expect(logText).not.toContain('Bí Mật');
    expect(logText).not.toContain('0900000000');

    // Phần không mồ côi đã được điền sẵn; bản ghi mồ côi KHÔNG bị gán code bừa.
    const filled = await db.collection('customers').findOne({ _id: c1._id });
    expect(filled).toMatchObject({
      statusCode: 'NEW',
      areaCode: 'TP_HO_CHI_MINH',
    });
    const bad = await db
      .collection('customers')
      .findOne({ _id: orphanCustomer._id });
    expect(bad?.statusCode).toBeUndefined();
    expect(bad?.interestedProjectCodes).toBeUndefined();
    expect(await db.collection('system').countDocuments()).toBe(0);

    // Xử lý mồ côi xong thì chạy lại thành công và bất biến đạt.
    await db.collection('customers').deleteOne({ _id: orphanCustomer._id });
    await db.collection('care_logs').deleteOne({ _id: orphanLog._id });
    await expect(migrateCatalogCodes(db, true)).resolves.toMatchObject({
      orphans: [],
    });
    expect(await countIdWithoutCode(db)).toBe(0);
  });

  it('dry-run không ném lỗi mồ côi mà chỉ liệt kê trong kết quả', async () => {
    const db = freshDb();
    await seedOldData(db);
    const ghost = id();
    const orphanId = id();
    await db.collection('appointments').insertOne({
      _id: orphanId,
      projectId: ghost,
      ...stamps,
    });

    const result = await migrateCatalogCodes(db, false);

    expect(result.orphans).toEqual([
      `appointments:${String(orphanId)}:${String(ghost)}`,
    ]);
  });

  it('rollback rồi chạy tiến: bản ghi chỉ có id (do bản cũ ghi chen) được bù, lần sau đếm 0', async () => {
    const db = freshDb();
    const { c1 } = await seedOldData(db);
    await migrateCatalogCodes(db, true);

    // Bản app cũ (rollback) tạo thêm khách chỉ có id, không có code nào.
    const lateCustomer = {
      _id: id(),
      statusId: c1.statusId,
      sourceId: c1.sourceId,
      areaId: null,
      interestedProjectIds: c1.interestedProjectIds,
      ...stamps,
    };
    await db.collection('customers').insertOne(lateCustomer);
    expect(await countIdWithoutCode(db)).toBeGreaterThan(0);

    const result = await migrateCatalogCodes(db, true);

    expect(result).toMatchObject({
      ...ZERO_COUNTS,
      customersStatusCoded: 1,
      customersSourceCoded: 1,
      customersProjectsCoded: 1,
      areaIndexCreated: false,
      orphans: [],
    });
    expect(await countIdWithoutCode(db)).toBe(0);
    const late = await db
      .collection('customers')
      .findOne({ _id: lateCustomer._id });
    expect(late).toMatchObject({
      statusCode: 'NEW',
      sourceCode: 'FB',
      interestedProjectCodes: ['QTERRA', 'NOAREA'],
      updatedAt: OLD_DATE,
      version: 3,
    });
    expect(await migrateCatalogCodes(db, true)).toMatchObject(ZERO_COUNTS);
  });

  it('khách quá một lô (500): vẫn điền đủ interestedProjectCodes', async () => {
    const db = freshDb();
    await seedOldData(db);
    const extra = Array.from({ length: 1100 }, () => ({
      _id: id(),
      statusId: null,
      interestedProjectIds: [],
      ...stamps,
    }));
    await db.collection('customers').insertMany(extra);

    await migrateCatalogCodes(db, true);

    expect(
      await db
        .collection('customers')
        .countDocuments({ interestedProjectCodes: { $exists: false } }),
    ).toBe(0);
    expect(await migrateCatalogCodes(db, true)).toMatchObject(ZERO_COUNTS);
  });
});
