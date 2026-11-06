/**
 * INTEGRATION — migration 008 (ánh xạ chữ loại hình dự án sang mã `property_type`, FR-46) trên MongoDB Replica Set thật
 * (mongodb-memory-server). Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../../../../shared/database/memory-replset.util';
import {
  migrateProjectPropertyTypeCodes,
  PropertyTypeFieldMissingError,
} from './migrate-project-property-type-codes';

jest.setTimeout(240_000);

const OLD_DATE = new Date('2026-01-01T00:00:00.000Z');

describe('migrateProjectPropertyTypeCodes', () => {
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

  const stamps = { version: 3, updatedAt: OLD_DATE };
  const id = () => new ObjectId();
  const freshDb = (): Db => client.db(`mig008_${(dbCounter += 1)}`);

  const seedPersonaField = async (db: Db) => {
    await db.collection('persona_fields').insertOne({
      _id: id(),
      key: 'property_type',
      options: [
        { value: 'APARTMENT', label: 'Căn hộ chung cư', isActive: true },
        { value: 'TOWNHOUSE', label: 'Nhà phố / Shophouse', isActive: true },
        { value: 'VILLA', label: 'Biệt thự / Villa', isActive: true },
        { value: 'LAND', label: 'Đất nền', isActive: true },
        // Lựa chọn đã tắt vẫn được dùng để ánh xạ.
        { value: 'CONDOTEL', label: 'Condotel / Nghỉ dưỡng', isActive: false },
      ],
      ...stamps,
    });
  };

  /** Dữ liệu CŨ (trước 008): dự án chỉ có `propertyTypes` chữ tự do. */
  const seedProjects = async (db: Db) => {
    const all = {
      _id: id(),
      codeNormalized: 'ALL',
      propertyTypes: ['Căn hộ', 'nhà phố', 'BIỆT THỰ', 'Đất nền', 'Condotel'],
    };
    const dup = {
      _id: id(),
      codeNormalized: 'DUP',
      propertyTypes: ['Căn hộ', 'căn hộ chung cư', 'APARTMENT'],
    };
    const mixed = {
      _id: id(),
      codeNormalized: 'MIXED',
      propertyTypes: ['Villa', 'Officetel', 'Shophouse', 'Kho xưởng'],
    };
    const none = { _id: id(), codeNormalized: 'NONE', propertyTypes: [] };
    const noField = { _id: id(), codeNormalized: 'NOFIELD' };
    // Dự án xóa mềm cũng được ánh xạ.
    const deleted = {
      _id: id(),
      codeNormalized: 'DELETED',
      propertyTypes: ['Đất nền'],
      deletedAt: OLD_DATE,
    };
    // Đã có propertyTypeCodes (do image mới ghi): không bị đụng tới.
    const already = {
      _id: id(),
      codeNormalized: 'ALREADY',
      propertyTypes: ['Biệt thự'],
      propertyTypeCodes: ['LAND'],
      unmappedPropertyTypes: [],
    };
    const docs = [all, dup, mixed, none, noField, deleted, already];
    await db
      .collection('projects')
      .insertMany(docs.map((doc) => ({ ...doc, ...stamps })));
    return { all, dup, mixed, none, noField, deleted, already };
  };

  const snapshot = async (db: Db) =>
    db.collection('projects').find({}).sort({ _id: 1 }).toArray();

  /** Bản sao bản ghi đã bỏ hai field do migration thêm, để so phần còn lại có y nguyên không. */
  const withoutNewFields = (doc: Record<string, unknown>) => {
    const copy = { ...doc };
    delete copy.propertyTypeCodes;
    delete copy.unmappedPropertyTypes;
    return copy;
  };

  const findProject = (db: Db, projectId: ObjectId) =>
    db.collection('projects').findOne({ _id: projectId });

  it('dry-run: đếm đúng, liệt kê chữ không khớp và KHÔNG ghi gì', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    await seedProjects(db);
    const before = await snapshot(db);

    const result = await migrateProjectPropertyTypeCodes(db, false);

    // 6 dự án chưa có propertyTypeCodes (trừ `already`); 1 dự án (`mixed`) có chữ không khớp.
    expect(result.projectsCoded).toBe(6);
    expect(result.projectsWithUnmapped).toBe(1);
    expect([...result.unmappedTexts].sort()).toEqual([
      'Kho xưởng',
      'Officetel',
    ]);
    expect(await snapshot(db)).toEqual(before);
  });

  it('khớp qua nhãn/value/bảng từ đồng nghĩa; không khớp vào unmappedPropertyTypes; bỏ trùng giữ thứ tự', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    const { all, dup, mixed, none, noField, deleted } = await seedProjects(db);

    const result = await migrateProjectPropertyTypeCodes(db, true);

    expect(result).toMatchObject({
      projectsCoded: 6,
      projectsWithUnmapped: 1,
    });
    expect(await findProject(db, all._id)).toMatchObject({
      propertyTypeCodes: [
        'APARTMENT',
        'TOWNHOUSE',
        'VILLA',
        'LAND',
        'CONDOTEL',
      ],
      unmappedPropertyTypes: [],
    });
    expect(await findProject(db, dup._id)).toMatchObject({
      propertyTypeCodes: ['APARTMENT'],
      unmappedPropertyTypes: [],
    });
    expect(await findProject(db, mixed._id)).toMatchObject({
      propertyTypeCodes: ['VILLA', 'TOWNHOUSE'],
      unmappedPropertyTypes: ['Officetel', 'Kho xưởng'],
    });
    expect(await findProject(db, none._id)).toMatchObject({
      propertyTypeCodes: [],
      unmappedPropertyTypes: [],
    });
    expect(await findProject(db, noField._id)).toMatchObject({
      propertyTypeCodes: [],
      unmappedPropertyTypes: [],
    });
    expect(await findProject(db, deleted._id)).toMatchObject({
      propertyTypeCodes: ['LAND'],
    });
  });

  it('không mất dữ liệu: propertyTypes cũ giữ nguyên, dự án đã có propertyTypeCodes không bị đụng, mọi field khác y nguyên', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    const { mixed, already } = await seedProjects(db);
    const before = await snapshot(db);

    await migrateProjectPropertyTypeCodes(db, true);

    const after = await snapshot(db);
    expect(after).toHaveLength(before.length);
    for (const [index, doc] of after.entries()) {
      // Bỏ hai field mới thì bản ghi phải trùng bản trước (propertyTypes chữ cũ nguyên văn).
      expect(withoutNewFields(doc)).toEqual(withoutNewFields(before[index]));
    }
    expect((await findProject(db, mixed._id))?.propertyTypes).toEqual([
      'Villa',
      'Officetel',
      'Shophouse',
      'Kho xưởng',
    ]);
    expect(await findProject(db, already._id)).toEqual(
      before.find((doc) => doc._id.equals(already._id)),
    );
  });

  it('chạy lần hai: đếm 0 và dữ liệu không đổi (idempotent)', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    await seedProjects(db);
    await migrateProjectPropertyTypeCodes(db, true);
    const afterFirst = await snapshot(db);

    const second = await migrateProjectPropertyTypeCodes(db, true);

    expect(second).toEqual({
      projectsCoded: 0,
      projectsWithUnmapped: 0,
      unmappedTexts: [],
    });
    expect(await snapshot(db)).toEqual(afterFirst);
  });

  it('không đổi updatedAt / version của bất kỳ dự án nào', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    await seedProjects(db);

    await migrateProjectPropertyTypeCodes(db, true);

    const docs = await snapshot(db);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.updatedAt).toEqual(OLD_DATE);
      expect(doc.version).toBe(3);
    }
  });

  it('thiếu trường property_type: ném lỗi (cả dry-run) và không ghi gì', async () => {
    const db = freshDb();
    await seedProjects(db);
    const before = await snapshot(db);

    await expect(migrateProjectPropertyTypeCodes(db, true)).rejects.toThrow(
      PropertyTypeFieldMissingError,
    );
    await expect(migrateProjectPropertyTypeCodes(db, false)).rejects.toThrow(
      PropertyTypeFieldMissingError,
    );
    expect(await snapshot(db)).toEqual(before);
  });

  it('thiếu trường property_type nhưng KHÔNG có dự án cần mã (DB trống / dự án không có chữ loại hình): OK kèm cảnh báo, không ghi', async () => {
    const empty = freshDb();
    const logEmpty: string[] = [];
    for (const apply of [false, true]) {
      expect(
        await migrateProjectPropertyTypeCodes(empty, apply, (m) =>
          logEmpty.push(m),
        ),
      ).toEqual({
        projectsCoded: 0,
        projectsWithUnmapped: 0,
        unmappedTexts: [],
      });
    }
    expect(logEmpty.some((m) => m.includes('CẢNH BÁO'))).toBe(true);

    // Có dự án nhưng không có chữ nào cần dịch (rỗng / thiếu field / đã có mã): vẫn là "không có việc".
    const db = freshDb();
    await db.collection('projects').insertMany([
      { _id: id(), propertyTypes: [], ...stamps },
      { _id: id(), ...stamps },
      { _id: id(), propertyTypes: ['  '], ...stamps },
      {
        _id: id(),
        propertyTypes: ['Căn hộ'],
        propertyTypeCodes: [],
        ...stamps,
      },
    ]);
    const before = await snapshot(db);
    await expect(migrateProjectPropertyTypeCodes(db, true)).resolves.toEqual({
      projectsCoded: 0,
      projectsWithUnmapped: 0,
      unmappedTexts: [],
    });
    expect(await snapshot(db)).toEqual(before);
  });

  it('trường property_type không có lựa chọn nào: ném lỗi, không đoán', async () => {
    const db = freshDb();
    await db
      .collection('persona_fields')
      .insertOne({ _id: id(), key: 'property_type', options: [], ...stamps });
    await seedProjects(db);

    await expect(migrateProjectPropertyTypeCodes(db, true)).rejects.toThrow(
      PropertyTypeFieldMissingError,
    );
    expect(
      await db
        .collection('projects')
        .countDocuments({ propertyTypeCodes: { $exists: true } }),
    ).toBe(1);
  });

  it('dự án chỉ trỏ lựa chọn đã bị bỏ khỏi cấu hình: vào unmapped, bản ghi vẫn còn nguyên chữ cũ', async () => {
    const db = freshDb();
    await db.collection('persona_fields').insertOne({
      _id: id(),
      key: 'property_type',
      options: [{ value: 'VILLA', label: 'Biệt thự', isActive: true }],
      ...stamps,
    });
    const project = {
      _id: id(),
      codeNormalized: 'ONLYAPT',
      propertyTypes: ['Căn hộ'],
      ...stamps,
    };
    await db.collection('projects').insertOne(project);

    await migrateProjectPropertyTypeCodes(db, true);

    // Bảng từ đồng nghĩa chỉ có tác dụng khi lựa chọn đích tồn tại trong cấu hình.
    expect(await findProject(db, project._id)).toMatchObject({
      propertyTypes: ['Căn hộ'],
      propertyTypeCodes: [],
      unmappedPropertyTypes: ['Căn hộ'],
    });
  });

  it('quá một lô (500): vẫn xử lý đủ, lần sau đếm 0', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    const extra = Array.from({ length: 1100 }, () => ({
      _id: id(),
      propertyTypes: ['Căn hộ'],
      ...stamps,
    }));
    await db.collection('projects').insertMany(extra);

    const first = await migrateProjectPropertyTypeCodes(db, true);

    expect(first.projectsCoded).toBe(1100);
    expect(
      await db
        .collection('projects')
        .countDocuments({ propertyTypeCodes: { $exists: false } }),
    ).toBe(0);
    expect(
      (await migrateProjectPropertyTypeCodes(db, true)).projectsCoded,
    ).toBe(0);
  });

  it('dự án mới tạo bởi image cũ sau khi chạy (rollback rồi tiến): được bù ở lần chạy sau', async () => {
    const db = freshDb();
    await seedPersonaField(db);
    await seedProjects(db);
    await migrateProjectPropertyTypeCodes(db, true);
    const late = {
      _id: id(),
      codeNormalized: 'LATE',
      propertyTypes: ['Đất nền'],
      ...stamps,
    };
    await db.collection('projects').insertOne(late);

    const result = await migrateProjectPropertyTypeCodes(db, true);

    expect(result.projectsCoded).toBe(1);
    expect(await findProject(db, late._id)).toMatchObject({
      propertyTypeCodes: ['LAND'],
      unmappedPropertyTypes: [],
    });
  });
});
