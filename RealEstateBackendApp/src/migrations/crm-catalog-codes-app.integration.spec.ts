/**
 * INTEGRATION — lệnh bù `crm-catalog-codes` trên MongoDB Replica Set thật (mongodb-memory-server).
 * Chạy bằng `npm run test:integration`.
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCatalogCodesCli } from './crm-catalog-codes-app';
import { EXIT_CODE } from './migration-runner';

jest.setTimeout(240_000);

describe('runCatalogCodesCli (Mongo thật)', () => {
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

  const run = async (argv: string[], dbName: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCatalogCodesCli(argv, {
      mongoUri: replSet.getUri(dbName),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { code, out, err };
  };

  const OLD_DATE = new Date('2026-01-01T00:00:00.000Z');

  /** Trường chân dung `property_type` (điều kiện để bước 008 chạy được). */
  const seedPersonaField = async (db: Db) => {
    await db.collection('persona_fields').insertOne({
      _id: new ObjectId(),
      key: 'property_type',
      options: [
        { value: 'APARTMENT', label: 'Căn hộ chung cư', isActive: true },
        { value: 'VILLA', label: 'Biệt thự / Villa', isActive: true },
      ],
    });
  };

  /** Dự án do image v1.0.3 tạo sau migration 008: chỉ có chữ tự do, thiếu `propertyTypeCodes`. */
  const seedLegacyProject = async (db: Db, propertyTypes: string[]) => {
    const _id = new ObjectId();
    await db
      .collection('projects')
      .insertOne({ _id, propertyTypes, version: 3, updatedAt: OLD_DATE });
    return _id;
  };

  const seed = async (dbName: string, ghostStatus = false) => {
    const db = client.db(dbName);
    await seedPersonaField(db);
    const statusId = new ObjectId();
    await db
      .collection('customer_statuses')
      .insertOne({ _id: statusId, code: 'NEW' });
    await db.collection('customers').insertOne({
      _id: new ObjectId(),
      statusId: ghostStatus ? new ObjectId() : statusId,
      interestedProjectIds: [],
    });
    return db;
  };

  it('mặc định là dry-run: mã thoát 0 và không ghi gì', async () => {
    const db = await seed('mig007_cli_dry');

    const { code, out } = await run([], 'mig007_cli_dry');

    expect(code).toBe(EXIT_CODE.OK);
    expect(out.join('\n')).toContain('Dry-run');
    expect(
      await db.collection('customers').countDocuments({ statusCode: 'NEW' }),
    ).toBe(0);
  });

  it('--apply: mã thoát 0, điền mã; chạy lại vẫn mã thoát 0', async () => {
    const db = await seed('mig007_cli_apply');

    expect((await run(['--apply'], 'mig007_cli_apply')).code).toBe(
      EXIT_CODE.OK,
    );
    expect(
      await db.collection('customers').countDocuments({ statusCode: 'NEW' }),
    ).toBe(1);
    expect((await run(['--apply'], 'mig007_cli_apply')).code).toBe(
      EXIT_CODE.OK,
    );
  });

  it('--apply gặp bản ghi mồ côi: mã thoát 1 và in id mồ côi ra stderr', async () => {
    await seed('mig007_cli_orphan', true);

    const { code, err } = await run(['--apply'], 'mig007_cli_orphan');

    expect(code).toBe(EXIT_CODE.FAILURE);
    expect(err.join('\n')).toContain('mồ côi customers:');
  });

  describe('bước 008 (mã loại hình dự án)', () => {
    it('--apply chạy CẢ HAI bước: khách có statusCode, dự án thiếu propertyTypeCodes được bù, propertyTypes giữ nguyên', async () => {
      const db = await seed('mig_cli_both');
      const projectId = await seedLegacyProject(db, [
        'Căn hộ',
        'Biệt thự',
        'Lạ',
      ]);

      const { code, out } = await run(['--apply'], 'mig_cli_both');

      expect(code).toBe(EXIT_CODE.OK);
      expect(out.join('\n')).toContain('[1/2]');
      expect(out.join('\n')).toContain('[2/2]');
      expect(
        await db.collection('customers').countDocuments({ statusCode: 'NEW' }),
      ).toBe(1);
      const project = await db
        .collection('projects')
        .findOne({ _id: projectId });
      expect(project?.propertyTypeCodes).toEqual(['APARTMENT', 'VILLA']);
      expect(project?.unmappedPropertyTypes).toEqual(['Lạ']);
      expect(project?.propertyTypes).toEqual(['Căn hộ', 'Biệt thự', 'Lạ']);
    });

    it('chạy lại --apply: đếm 0, không đổi updatedAt/version/propertyTypeCodes', async () => {
      const db = await seed('mig_cli_rerun');
      const projectId = await seedLegacyProject(db, ['Căn hộ']);
      await run(['--apply'], 'mig_cli_rerun');
      const before = await db
        .collection('projects')
        .findOne({ _id: projectId });

      const second = await run(['--apply'], 'mig_cli_rerun');

      expect(second.code).toBe(EXIT_CODE.OK);
      expect(second.out.join('\n')).toContain('projectsCoded=0');
      const after = await db.collection('projects').findOne({ _id: projectId });
      expect(after).toEqual(before);
      expect(after?.version).toBe(3);
      expect(after?.updatedAt).toEqual(OLD_DATE);
    });

    it('dry-run: mã thoát 0, báo số dự án cần bù nhưng KHÔNG ghi', async () => {
      const db = await seed('mig_cli_dry2');
      const projectId = await seedLegacyProject(db, ['Căn hộ']);

      const { code, out } = await run([], 'mig_cli_dry2');

      expect(code).toBe(EXIT_CODE.OK);
      expect(out.join('\n')).toContain('projectsCoded=1');
      const project = await db
        .collection('projects')
        .findOne({ _id: projectId });
      expect(project).not.toHaveProperty('propertyTypeCodes');
    });

    it('bước 007 lỗi (mồ côi): mã thoát 1, bước 008 VẪN chạy và bù dự án', async () => {
      const db = await seed('mig_cli_007_fail', true);
      const projectId = await seedLegacyProject(db, ['Căn hộ']);

      const { code, out, err } = await run(['--apply'], 'mig_cli_007_fail');

      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(err.join('\n')).toContain('LỖI [1/2]');
      expect(err.join('\n')).toContain('mồ côi customers:');
      expect(out.join('\n')).toContain('[2/2] mã loại hình dự án (008): OK');
      const project = await db
        .collection('projects')
        .findOne({ _id: projectId });
      expect(project?.propertyTypeCodes).toEqual(['APARTMENT']);
    });

    it('DB trống (chưa seed property_type, chưa có dự án): mã thoát 0 cả dry-run lẫn --apply, bước 008 OK kèm cảnh báo', async () => {
      client.db('mig_cli_empty');
      for (const argv of [[], ['--apply']]) {
        const { code, out, err } = await run(argv, 'mig_cli_empty');

        expect(code).toBe(EXIT_CODE.OK);
        expect(err).toEqual([]);
        expect(out.join('\n')).toContain('CẢNH BÁO');
        expect(out.join('\n')).toContain('[2/2] mã loại hình dự án (008): OK');
      }
    });

    it('thiếu cấu hình property_type: mã thoát 1, bước 007 VẪN điền mã khách, không ghi dự án', async () => {
      const db = client.db('mig_cli_008_fail');
      const statusId = new ObjectId();
      await db
        .collection('customer_statuses')
        .insertOne({ _id: statusId, code: 'NEW' });
      await db.collection('customers').insertOne({
        _id: new ObjectId(),
        statusId,
        interestedProjectIds: [],
      });
      const projectId = await seedLegacyProject(db, ['Căn hộ']);

      const { code, out, err } = await run(['--apply'], 'mig_cli_008_fail');

      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(err.join('\n')).toContain('LỖI [2/2]');
      expect(err.join('\n')).toContain('property_type');
      expect(out.join('\n')).toContain('[1/2] mã danh mục (007): OK');
      expect(
        await db.collection('customers').countDocuments({ statusCode: 'NEW' }),
      ).toBe(1);
      const project = await db
        .collection('projects')
        .findOne({ _id: projectId });
      expect(project).not.toHaveProperty('propertyTypeCodes');
    });
  });
});
