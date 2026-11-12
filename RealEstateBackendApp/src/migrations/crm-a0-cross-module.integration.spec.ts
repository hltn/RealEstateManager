/**
 * INTEGRATION xuyên module A0 (T-19, FR-40/FR-46): registry THẬT (007/008/009) qua `reconcile` trên dữ liệu CRM cũ
 * chỉ có id ở MỌI collection, rồi kịch bản "lùi (image v1.0.3 ghi chen) rồi tiến (lệnh bù)". Dữ liệu giả hoàn toàn.
 * Chạy bằng `npm run test:integration`.
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { CatalogItemType } from '../modules/crm/catalogs/catalog.enums';
import { runCli } from './cli-app';
import { runCatalogCodesCli } from './crm-catalog-codes-app';
import { EXIT_CODE } from './migration-runner';
import { MIGRATIONS } from './migration.registry';

jest.setTimeout(240_000);

const OLD = new Date('2026-01-01T00:00:00.000Z');
const stamps = { version: 3, updatedAt: OLD, lastUpdatedAt: OLD };
const APP = { version: '1.0.4', commit: 'abc1234' };

describe('A0 xuyên module: registry thật + lùi rồi tiến', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let n = 0;

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    client = new MongoClient(replSet.getUri());
    await client.connect();
  });
  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  const reconcile = async (name: string) => {
    const err: string[] = [];
    const code = await runCli(
      ['reconcile', '--apply', '--by', 'deploy', '--skip-version'],
      {
        mongoUri: replSet.getUri(name),
        migrations: MIGRATIONS,
        app: APP,
        out: () => undefined,
        err: (l) => err.push(l),
      },
    );
    return { code, err: err.join('\n') };
  };
  const bu = async (name: string, argv: string[]) => {
    const err: string[] = [];
    const code = await runCatalogCodesCli(argv, {
      mongoUri: replSet.getUri(name),
      out: () => undefined,
      err: (l) => err.push(l),
    });
    return { code, err: err.join('\n') };
  };

  const seedLegacy = async (db: Db) => {
    const id = () => new ObjectId();
    await db.collection('persona_fields').insertOne({
      _id: id(),
      key: 'property_type',
      options: [
        { value: 'APARTMENT', label: 'Căn hộ chung cư', isActive: true },
        { value: 'VILLA', label: 'Biệt thự / Villa', isActive: true },
      ],
    });
    const area = {
      _id: id(),
      name: 'Hà Nội',
      nameNormalized: 'ha noi',
      parentId: null,
      type: 'PROVINCE',
      ancestorIds: [],
      isActive: true,
      deletedAt: null,
      ...stamps,
    };
    await db.collection('areas').insertOne(area);
    const status = { _id: id(), code: 'NEW', ...stamps };
    await db.collection('customer_statuses').insertOne(status);
    const source = {
      _id: id(),
      type: CatalogItemType.LEAD_SOURCE,
      code: 'FB',
      ...stamps,
    };
    const result = {
      _id: id(),
      type: CatalogItemType.CONTACT_RESULT,
      code: 'NO_ANSWER',
      ...stamps,
    };
    await db.collection('catalog_items').insertMany([source, result]);
    const project = {
      _id: id(),
      codeNormalized: 'QTERRA',
      areaId: area._id,
      propertyTypes: ['Căn hộ', 'Loại lạ'],
      ...stamps,
    };
    await db.collection('projects').insertOne(project);
    const customer = {
      _id: id(),
      statusId: status._id,
      sourceId: source._id,
      areaId: area._id,
      interestedProjectIds: [project._id],
      ...stamps,
    };
    await db.collection('customers').insertOne(customer);
    await db.collection('care_logs').insertOne({
      _id: id(),
      customerId: customer._id,
      contactResultId: result._id,
      ...stamps,
    });
    await db.collection('appointments').insertOne({
      _id: id(),
      customerId: customer._id,
      projectId: project._id,
      ...stamps,
    });
    // Collection có dữ liệu cho migration 009.
    await db
      .collection('notifications')
      .insertOne({ _id: id(), pushStatus: 'PENDING', createdAt: OLD });
    await db
      .collection('crm_attachments')
      .insertOne({ _id: id(), thumbStatus: 'NONE', createdAt: OLD });
    return { status, source, project, area, result, customer };
  };

  const idWithoutCode = async (db: Db): Promise<number> => {
    const checks: Array<[string, string, string]> = [
      ['projects', 'areaId', 'areaCode'],
      ['customers', 'statusId', 'statusCode'],
      ['customers', 'sourceId', 'sourceCode'],
      ['customers', 'areaId', 'areaCode'],
      ['care_logs', 'contactResultId', 'contactResultCode'],
      ['appointments', 'projectId', 'projectCode'],
    ];
    let total = 0;
    for (const [c, i, k] of checks) {
      total += await db
        .collection(c)
        .countDocuments({ [i]: { $ne: null }, [k]: null });
    }
    total += await db
      .collection('customers')
      .countDocuments({ interestedProjectCodes: { $exists: false } });
    total += await db
      .collection('projects')
      .countDocuments({ propertyTypeCodes: { $exists: false } });
    return total;
  };

  const business = async (db: Db) => {
    const out: Record<string, unknown[]> = {};
    for (const c of [
      'areas',
      'customer_statuses',
      'catalog_items',
      'projects',
      'customers',
      'care_logs',
      'appointments',
      'notifications',
      'crm_attachments',
    ]) {
      out[c] = await db.collection(c).find({}).sort({ _id: 1 }).toArray();
    }
    return out;
  };

  it('reconcile thật trên dữ liệu cũ: ghi sổ 007..011, bất biến 3.1, không đổi updatedAt/version, đổi nhãn không đổi code', async () => {
    const name = `a0x_${(n += 1)}`;
    const db = client.db(name);
    const seeded = await seedLegacy(db);

    const first = await reconcile(name);
    expect(first.code).toBe(EXIT_CODE.OK);
    expect(await idWithoutCode(db)).toBe(0);

    const ledger = (await db.collection('system').find().toArray())
      .map((d) => String(d._id))
      .filter((x) => x.startsWith('migration:0'))
      .sort();
    expect(ledger).toEqual([
      'migration:007_crm_catalog_codes',
      'migration:008_crm_project_property_type_codes',
      'migration:009_notification_attachment_indexes',
      'migration:010_crm_customer_code_index',
      'migration:011_crm_drop_unique_phone',
    ]);

    const customer = await db
      .collection('customers')
      .findOne({ _id: seeded.customer._id });
    expect(customer).toMatchObject({
      statusCode: 'NEW',
      sourceCode: 'FB',
      areaCode: 'HA_NOI',
      interestedProjectCodes: ['QTERRA'],
      version: 3,
      updatedAt: OLD,
    });
    const project = await db
      .collection('projects')
      .findOne({ _id: seeded.project._id });
    expect(project).toMatchObject({
      areaCode: 'HA_NOI',
      propertyTypeCodes: ['APARTMENT'],
      unmappedPropertyTypes: ['Loại lạ'],
      propertyTypes: ['Căn hộ', 'Loại lạ'],
      version: 3,
      updatedAt: OLD,
    });

    const notifIdx = await db.collection('notifications').indexes();
    expect(
      notifIdx.some((i) => i.key.pushStatus === 1 && i.key.createdAt === 1),
    ).toBe(true);

    // Đổi nhãn danh mục (khác code) không làm bản ghi khách mất tham chiếu.
    await db
      .collection('customer_statuses')
      .updateOne({ _id: seeded.status._id }, { $set: { label: 'Mới đổi' } });
    expect(
      await db
        .collection('customers')
        .countDocuments({ statusCode: 'NEW', statusId: seeded.status._id }),
    ).toBe(1);

    // Lần hai: không đổi gì ở dữ liệu nghiệp vụ.
    const snap = await business(db);
    expect((await reconcile(name)).code).toBe(EXIT_CODE.OK);
    expect(await business(db)).toEqual(snap);
  });

  it('lùi rồi tiến: image v1.0.3 ghi chen bản ghi chỉ-id ở mọi collection, lệnh bù điền đủ, lần sau không đổi gì', async () => {
    const name = `a0x_${(n += 1)}`;
    const db = client.db(name);
    const seeded = await seedLegacy(db);
    expect((await reconcile(name)).code).toBe(EXIT_CODE.OK);

    const id = () => new ObjectId();
    // Bản cũ (không biết `…Code`) tạo thêm dữ liệu chỉ có id.
    const lateProject = {
      _id: id(),
      codeNormalized: 'LATE',
      areaId: seeded.area._id,
      propertyTypes: ['Biệt thự / Villa'],
      ...stamps,
    };
    await db.collection('projects').insertOne(lateProject);
    const lateCustomer = {
      _id: id(),
      statusId: seeded.status._id,
      sourceId: seeded.source._id,
      areaId: seeded.area._id,
      interestedProjectIds: [seeded.project._id, lateProject._id],
      ...stamps,
    };
    await db.collection('customers').insertOne(lateCustomer);
    await db.collection('care_logs').insertOne({
      _id: id(),
      customerId: lateCustomer._id,
      contactResultId: seeded.result._id,
      ...stamps,
    });
    await db.collection('appointments').insertOne({
      _id: id(),
      customerId: lateCustomer._id,
      projectId: lateProject._id,
      ...stamps,
    });
    expect(await idWithoutCode(db)).toBeGreaterThan(0);

    // Lần reconcile sau KHÔNG chạy lại 007 (đã ghi sổ) nên không tự lành; lệnh bù mới là đường tiến.
    expect((await reconcile(name)).code).toBe(EXIT_CODE.OK);
    expect(await idWithoutCode(db)).toBeGreaterThan(0);

    const dry = await bu(name, []);
    expect(dry.code).toBe(0);
    expect(await idWithoutCode(db)).toBeGreaterThan(0);

    const applied = await bu(name, ['--apply']);
    expect(applied.code).toBe(0);
    expect(await idWithoutCode(db)).toBe(0);

    const late = await db
      .collection('customers')
      .findOne({ _id: lateCustomer._id });
    expect(late).toMatchObject({
      statusCode: 'NEW',
      sourceCode: 'FB',
      areaCode: 'HA_NOI',
      interestedProjectCodes: ['QTERRA', 'LATE'],
      updatedAt: OLD,
      version: 3,
    });
    expect(
      await db.collection('projects').findOne({ _id: lateProject._id }),
    ).toMatchObject({
      areaCode: 'HA_NOI',
      propertyTypeCodes: ['VILLA'],
      updatedAt: OLD,
    });

    const snap = await business(db);
    expect((await bu(name, ['--apply'])).code).toBe(0);
    expect(await business(db)).toEqual(snap);
  });
});
