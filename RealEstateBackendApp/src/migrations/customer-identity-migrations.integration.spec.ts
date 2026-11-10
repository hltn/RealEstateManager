/**
 * INTEGRATION — migration 010 (index mã khách partial + counter) và 011 (bỏ unique phone, một chiều, post-up) trên
 * MongoDB Replica Set thật (mongodb-memory-server). Chạy bằng `npm run test:integration` (không nằm trong `npm test`).
 * Mỗi test ghi mã FR-xx mà nó kiểm (Plan 10_Dinh_Danh_Khach_Hang_Plan.md).
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db, Document } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  COUNTER_KEY,
  CUSTOMER_CODE_INDEX,
} from '../modules/crm/customers/customer-code.constants';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCli } from './cli-app';
import { EXIT_CODE } from './migration-runner';
import { MIGRATIONS } from './migration.registry';
import type { Migration } from './migration.types';

jest.setTimeout(240_000);

const ID_010 = '010_crm_customer_code_index';
const ID_011 = '011_crm_drop_unique_phone';
const DUPLICATE_KEY = 11000;

describe('migration 010/011 định danh khách (Mongo thật)', () => {
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

  const newDb = (): { db: Db; name: string } => {
    dbCounter += 1;
    const name = `custid_${dbCounter}`;
    return { db: client.db(name), name };
  };

  const find = (id: string): Migration => {
    const found = MIGRATIONS.find((m) => m.id === id);
    if (!found) throw new Error(`${id} chưa đăng ký trong registry`);
    return found;
  };
  const migrate = (id: string, db: Db) =>
    find(id).up({ client, db, log: () => undefined });

  const indexes = (db: Db): Promise<Document[]> =>
    db.collection('customers').indexes();
  const indexByName = async (
    db: Db,
    name: string,
  ): Promise<Document | undefined> =>
    (await indexes(db)).find((i) => i.name === name);

  /** Dựng `customers` như production trước migration: index unique `phone_1` (schema cũ). */
  const seedLegacyCustomers = async (db: Db): Promise<void> => {
    await db
      .collection('customers')
      .createIndex({ phone: 1 }, { unique: true });
    await db.collection('customers').insertMany([
      { _id: new ObjectId(), phone: '+84900000001', fullName: 'A' },
      { _id: new ObjectId(), phone: '+84900000002', fullName: 'B' },
      {
        _id: new ObjectId(),
        phone: 'anonymized:aaa',
        fullName: 'Đã ẩn danh 1',
        deletedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        phone: 'anonymized:bbb',
        fullName: 'Đã ẩn danh 2',
        deletedAt: new Date(),
      },
    ]);
  };

  describe('010_crm_customer_code_index', () => {
    it('FR-07: tạo đúng index partial unique theo CUSTOMER_CODE_INDEX và counter seq 0, không đụng dữ liệu/phone', async () => {
      const { db } = newDb();
      await seedLegacyCustomers(db);
      const before = await db.collection('customers').find().toArray();

      await migrate(ID_010, db);

      const index = await indexByName(db, 'customerCode_1');
      expect(index).toMatchObject({
        key: CUSTOMER_CODE_INDEX.key,
        unique: CUSTOMER_CODE_INDEX.options.unique,
        partialFilterExpression:
          CUSTOMER_CODE_INDEX.options.partialFilterExpression,
      });
      expect(
        await db.collection('counters').findOne({ _id: COUNTER_KEY as never }),
      ).toEqual({ _id: COUNTER_KEY, seq: 0 });
      expect(await db.collection('customers').find().toArray()).toEqual(before);
      // 010 không đụng phone_1: vẫn unique (chỉ 011 mới bỏ).
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);
    });

    it('FR-21: sau 010, image cũ ghi chen khách THIẾU mã vẫn thành công (partial không chặn)', async () => {
      const { db } = newDb();
      await seedLegacyCustomers(db);
      await migrate(ID_010, db);

      await expect(
        db.collection('customers').insertMany([
          { phone: '+84900000010', fullName: 'Image cũ 1' },
          { phone: '+84900000011', fullName: 'Image cũ 2', customerCode: null },
        ]),
      ).resolves.toMatchObject({ insertedCount: 2 });
    });

    it('FR-07: unique thật sự có hiệu lực với mã dạng chuỗi (trùng mã -> E11000)', async () => {
      const { db } = newDb();
      await migrate(ID_010, db);
      await db
        .collection('customers')
        .insertOne({ phone: '+84900000020', customerCode: 'KH-000001' });

      await expect(
        db
          .collection('customers')
          .insertOne({ phone: '+84900000021', customerCode: 'KH-000001' }),
      ).rejects.toMatchObject({ code: DUPLICATE_KEY });
    });

    it('FR-21: chạy lại idempotent: index không đổi, counter đã tăng không bị ghi đè', async () => {
      const { db } = newDb();
      await migrate(ID_010, db);
      await db
        .collection('counters')
        .updateOne({ _id: COUNTER_KEY as never }, { $set: { seq: 42 } });
      const indexesBefore = await indexes(db);

      await migrate(ID_010, db);

      expect(await indexes(db)).toEqual(indexesBefore);
      expect(
        await db.collection('counters').findOne({ _id: COUNTER_KEY as never }),
      ).toEqual({ _id: COUNTER_KEY, seq: 42 });
    });

    it('FR-21: DB trống (chưa có collection customers, cài mới) vẫn chạy được', async () => {
      const { db } = newDb();

      await expect(migrate(ID_010, db)).resolves.toBeUndefined();

      expect(await indexByName(db, 'customerCode_1')).toBeDefined();
    });

    it('FR-07: đã có customerCode_1 khác tùy chọn (unique không partial) -> lỗi rõ ràng, index giữ nguyên, không tạo counter', async () => {
      const { db } = newDb();
      await db
        .collection('customers')
        .createIndex(
          { customerCode: 1 },
          { name: 'customerCode_1', unique: true },
        );

      await expect(migrate(ID_010, db)).rejects.toThrow(
        /customerCode_1.*xung đột.*KHÔNG tự xóa/s,
      );

      const kept = await indexByName(db, 'customerCode_1');
      expect(kept?.unique).toBe(true);
      expect(kept?.partialFilterExpression).toBeUndefined();
      expect(await db.collection('counters').countDocuments()).toBe(0);
    });

    it('FR-07: index cùng khóa và cùng tùy chọn nhưng khác tên -> Mongo báo xung đột, migration đổi thành lỗi rõ ràng (không lộ lỗi driver thô)', async () => {
      const { db } = newDb();
      await db.collection('customers').createIndex(
        { customerCode: 1 },
        {
          ...CUSTOMER_CODE_INDEX.options,
          name: 'ten_khac',
          partialFilterExpression: { customerCode: { $type: 'string' } },
        },
      );

      await expect(migrate(ID_010, db)).rejects.toThrow(
        /xung đột.*KHÔNG tự xóa/s,
      );
      expect(await indexByName(db, 'customerCode_1')).toBeUndefined();
    });
  });

  describe('011_crm_drop_unique_phone (post-up, một chiều)', () => {
    it('FR-06, FR-01: gỡ unique phone_1, tạo phone_1 thường, chuyển hết anonymized về null; phone thật giữ nguyên', async () => {
      const { db } = newDb();
      await seedLegacyCustomers(db);

      await migrate(ID_011, db);

      const phoneIndex = await indexByName(db, 'phone_1');
      expect(phoneIndex).toBeDefined();
      expect(phoneIndex?.key).toEqual({ phone: 1 });
      expect(phoneIndex?.unique).toBeUndefined();
      expect(
        await db
          .collection('customers')
          .countDocuments({ phone: { $regex: '^anonymized:' } }),
      ).toBe(0);
      expect(
        await db.collection('customers').countDocuments({ phone: null }),
      ).toBe(2);
      const real = await db
        .collection('customers')
        .find({ phone: { $ne: null } })
        .toArray();
      expect(real.map((c) => c.phone).sort()).toEqual([
        '+84900000001',
        '+84900000002',
      ]);
    });

    it('FR-06: thứ tự bắt buộc — trên index unique cũ, chuyển nhiều anonymized về null sẽ E11000 (bước chuyển phải đứng sau dropIndex)', async () => {
      const { db } = newDb();
      await seedLegacyCustomers(db);

      await expect(
        db
          .collection('customers')
          .updateMany(
            { phone: { $regex: '^anonymized:' } },
            { $set: { phone: null } },
          ),
      ).rejects.toMatchObject({ code: DUPLICATE_KEY });

      // Migration thật làm đúng thứ tự nên không gặp lỗi đó.
      await expect(migrate(ID_011, db)).resolves.toBeUndefined();
    });

    it('FR-01, FR-02: sau 011, tạo được nhiều khách phone null và hai khách cùng SĐT', async () => {
      const { db } = newDb();
      await seedLegacyCustomers(db);
      await migrate(ID_011, db);

      await expect(
        db.collection('customers').insertMany([
          { phone: null, fullName: 'Không SĐT 1' },
          { phone: null, fullName: 'Không SĐT 2' },
          { phone: '+84900000001', fullName: 'Trùng SĐT A' },
        ]),
      ).resolves.toMatchObject({ insertedCount: 3 });
    });

    it('FR-21: chạy lại idempotent: index và dữ liệu không đổi', async () => {
      const { db } = newDb();
      await seedLegacyCustomers(db);
      await migrate(ID_011, db);
      const indexesBefore = await indexes(db);
      const dataBefore = await db.collection('customers').find().toArray();

      await migrate(ID_011, db);

      expect(await indexes(db)).toEqual(indexesBefore);
      expect(await db.collection('customers').find().toArray()).toEqual(
        dataBefore,
      );
    });

    it('FR-21: DB trống (chưa có customers) -> chỉ tạo phone_1 thường, không lỗi', async () => {
      const { db } = newDb();

      await migrate(ID_011, db);

      const phoneIndex = await indexByName(db, 'phone_1');
      expect(phoneIndex).toBeDefined();
      expect(phoneIndex?.unique).toBeUndefined();
    });

    it('FR-21: phone_1 đã là index thường từ trước -> giữ nguyên, vẫn dọn anonymized', async () => {
      const { db } = newDb();
      await db.collection('customers').createIndex({ phone: 1 });
      await db
        .collection('customers')
        .insertMany([{ phone: 'anonymized:x' }, { phone: 'anonymized:y' }]);

      await migrate(ID_011, db);

      expect((await indexByName(db, 'phone_1'))?.unique).toBeUndefined();
      expect(
        await db
          .collection('customers')
          .countDocuments({ phone: { $regex: '^anonymized:' } }),
      ).toBe(0);
    });
  });

  describe('chuỗi 007 -> 010 (pre-up) -> 011 (post-up) qua runner thật', () => {
    const APPLY = ['--apply', '--by', 'deploy', '--skip-version'];

    const run = async (name: string, argv: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runCli(argv, {
        mongoUri: replSet.getUri(name),
        migrations: MIGRATIONS,
        app: { version: '1.0.5', commit: 'abc1234' },
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      });
      return { code, out, err: err.join('\n') };
    };

    const ledger = async (db: Db): Promise<string[]> =>
      (await db.collection('system').find().toArray())
        .map((doc) => String(doc._id))
        .filter((id) => /^migration:01[01]_/.test(id))
        .sort();

    it('FR-21: --phase pre-up chỉ ghi sổ 010 (011 để lại, unique còn); --phase post-up mới chạy 011; chạy lại không đổi', async () => {
      const { db, name } = newDb();
      await seedLegacyCustomers(db);

      const pre = await run(name, ['reconcile', ...APPLY, '--phase', 'pre-up']);
      expect(pre.code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toEqual([`migration:${ID_010}`]);
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);
      expect(await indexByName(db, 'customerCode_1')).toBeDefined();

      // Image cũ ghi chen giữa 6b và `up`: khách thiếu mã, vẫn tạo được.
      await db
        .collection('customers')
        .insertOne({ phone: '+84900000099', fullName: 'Chen giữa' });

      const post = await run(name, [
        'reconcile',
        ...APPLY,
        '--phase',
        'post-up',
      ]);
      expect(post.code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toEqual([
        `migration:${ID_010}`,
        `migration:${ID_011}`,
      ]);
      expect((await indexByName(db, 'phone_1'))?.unique).toBeUndefined();
      expect(
        await db
          .collection('customers')
          .countDocuments({ phone: { $regex: '^anonymized:' } }),
      ).toBe(0);

      const dataBefore = await db.collection('customers').find().toArray();
      const again = await run(name, ['reconcile', ...APPLY]);
      expect(again.code).toBe(EXIT_CODE.OK);
      expect(await db.collection('customers').find().toArray()).toEqual(
        dataBefore,
      );
    });
  });
});
