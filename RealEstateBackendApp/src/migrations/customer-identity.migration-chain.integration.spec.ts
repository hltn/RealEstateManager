/**
 * INTEGRATION (T-34) — CHUỖI migration định danh khách trên MongoDB Replica Set thật (mongodb-memory-server):
 * 007 -> 010 (pre-up) -> (backend mới) -> script bù mã -> 011 (post-up), đúng thứ tự deploy 6b -> up -> 20 -> 90
 * (Architecture 11 mục 11.x). Bổ sung cho `customer-identity-migrations.integration.spec.ts` (từng migration riêng) và
 * `crm-customer-codes-app.integration.spec.ts` (script riêng): file này kiểm sự TƯƠNG TÁC giữa chúng.
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`). Dữ liệu giả hoàn toàn. Mỗi test ghi mã FR-xx.
 */
import mongoose from 'mongoose';
import { MongoClient, ObjectId } from 'mongodb';
import type { Db, Document } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  COUNTER_KEY,
  CUSTOMER_CODE_INDEX,
  formatCustomerCode,
} from '../modules/crm/customers/customer-code.constants';
import { CustomerSchema } from '../modules/crm/customers/schemas/customer.schema';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCli } from './cli-app';
import { runCustomerCodesCli } from './crm-customer-codes-app';
import type { CustomerCodesCliDeps } from './crm-customer-codes-app';
import { CUSTOMER_CODES_SCRIPT_DOC_ID } from './customer-codes-backfill';
import { EXIT_CODE } from './migration-runner';
import { MIGRATIONS } from './migration.registry';

jest.setTimeout(240_000);

const DUPLICATE_KEY = 11000;
const LEDGER_PREFIX = 'migration:';
const ID_007 = '007_crm_catalog_codes';
const ID_010 = '010_crm_customer_code_index';
const ID_011 = '011_crm_drop_unique_phone';
const APP = { version: '1.0.5', commit: 'abc1234' };
const day = (n: number): Date => new Date(Date.UTC(2026, 0, n));

/** Khách mẫu của DB "v1.0.3": phone unique cũ, có xóa mềm và `anonymized:`. Chèn KHÔNG theo thứ tự thời gian. */
interface SeedCustomer {
  _id: ObjectId;
  label: string;
  createdAt: Date;
  phone: string;
  statusId: ObjectId;
  deletedAt?: Date;
}

describe('chuỗi migration định danh khách 007 -> 010 -> bù mã -> 011 (Mongo thật)', () => {
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

  // ---------------------------------------------------------------- helpers

  const newDb = (): { db: Db; name: string } => {
    dbCounter += 1;
    const name = `custchain_${dbCounter}`;
    return { db: client.db(name), name };
  };

  /** Runner thật (`reconcile --apply`) theo pha, như `deploy.sh` (6b/8: pre-up; 90: post-up). */
  const reconcile = async (name: string, phase: 'pre-up' | 'post-up') => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(
      [
        'reconcile',
        '--apply',
        '--by',
        'deploy',
        '--skip-version',
        '--phase',
        phase,
      ],
      {
        mongoUri: replSet.getUri(name),
        migrations: MIGRATIONS,
        app: APP,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      },
    );
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  /** Script bù mã thật (bước 20 của deploy). */
  const backfill = async (
    name: string,
    argv: string[] = ['--apply'],
    extra: Partial<CustomerCodesCliDeps> = {},
  ) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCustomerCodesCli(argv, {
      mongoUri: replSet.getUri(name),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...extra,
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  const indexes = (db: Db): Promise<Document[]> =>
    db.collection('customers').indexes();
  const indexByName = async (
    db: Db,
    name: string,
  ): Promise<Document | undefined> =>
    (await indexes(db)).find((i) => i.name === name);

  /** Id các migration 007..011 đã ghi sổ (sắp tăng dần). */
  const ledger = async (db: Db): Promise<string[]> =>
    (await db.collection('system').find().toArray())
      .map((doc) => String(doc._id))
      .filter((id) => /^migration:0(0[7-9]|1[01])_/.test(id))
      .map((id) => id.slice(LEDGER_PREFIX.length))
      .sort();

  const counterSeq = async (db: Db): Promise<number | undefined> =>
    (
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .findOne({ _id: COUNTER_KEY })
    )?.seq;

  /** Mã khách theo nhãn (`label`) của DB mẫu. */
  const codesByLabel = async (db: Db): Promise<Record<string, unknown>> => {
    const rows = await db.collection('customers').find().toArray();
    return Object.fromEntries(rows.map((r) => [r.label, r.customerCode]));
  };

  /** Ảnh chụp toàn bộ khách (sắp theo `_id`) để so sánh "chạy lại không đổi". */
  const snapshot = (db: Db): Promise<Document[]> =>
    db.collection('customers').find().sort({ _id: 1 }).toArray();

  /**
   * DB v1.0.3 trước deploy: unique `phone_1`, danh mục trạng thái (007 sẽ điền `statusCode`), 5 khách gồm xóa mềm và
   * `anonymized:`. Thứ tự `createdAt` đúng: c1 < c2 < c3 < c4 < c5 (chèn xáo trộn).
   */
  const seedLegacy = async (
    db: Db,
  ): Promise<{ statusId: ObjectId; customers: SeedCustomer[] }> => {
    const statusId = new ObjectId();
    await db.collection('customer_statuses').insertOne({
      _id: statusId,
      code: 'NEW',
      version: 1,
      updatedAt: day(1),
      lastUpdatedAt: day(1),
    });
    await db
      .collection('customers')
      .createIndex({ phone: 1 }, { unique: true });
    const customers: SeedCustomer[] = [
      { label: 'c1', createdAt: day(1), phone: '+84900000001' },
      {
        label: 'c2-anon',
        createdAt: day(2),
        phone: 'anonymized:aaa',
        deletedAt: day(20),
      },
      {
        label: 'c3-deleted',
        createdAt: day(3),
        phone: '+84900000003',
        deletedAt: day(21),
      },
      {
        label: 'c4-anon',
        createdAt: day(4),
        phone: 'anonymized:bbb',
        deletedAt: day(22),
      },
      { label: 'c5', createdAt: day(5), phone: '+84900000005' },
    ].map((row) => ({ _id: new ObjectId(), statusId, ...row }));
    const shuffled = [2, 4, 0, 3, 1].map((i) => customers[i]);
    await db
      .collection('customers')
      .insertMany(
        shuffled.map((c) => ({ ...c, version: 1, updatedAt: c.createdAt })),
      );
    return { statusId, customers };
  };

  /** Image v1.0.3 còn phục vụ giữa 6b và `up`: tạo khách KHÔNG có `customerCode` (phone unique cũ vẫn áp dụng). */
  const oldImageCreates = (db: Db, label: string, phone: string, at: Date) =>
    db.collection('customers').insertOne({
      label,
      phone,
      createdAt: at,
      statusId: new ObjectId(),
    });

  /** Backend mới tạo khách: lấy số từ counter rồi ghi `customerCode` (như `CounterService.next` + `create`). */
  const newBackendCreates = async (
    db: Db,
    label: string,
    phone: string | null,
    at: Date,
  ): Promise<string> => {
    const counter = await db
      .collection<{ _id: string; seq: number }>('counters')
      .findOneAndUpdate(
        { _id: COUNTER_KEY },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      );
    const code = formatCustomerCode(counter!.seq);
    await db
      .collection('customers')
      .insertOne({ label, phone, createdAt: at, customerCode: code });
    return code;
  };

  const expectAllHaveUniqueCodes = async (db: Db): Promise<string[]> => {
    const rows = await db.collection('customers').find().toArray();
    const codes = rows.map((r) => r.customerCode as unknown);
    expect(codes.every((c) => typeof c === 'string')).toBe(true);
    expect(new Set(codes).size).toBe(rows.length);
    return codes as string[];
  };

  // ------------------------------------------------------------------ chuỗi

  describe('chuỗi đầy đủ trên DB mẫu (xóa mềm + anonymized:)', () => {
    it('FR-08, FR-21, FR-22: 6b pre-up -> image cũ ghi chen -> up -> backend mới -> bù mã -> 011: mã đủ/duy nhất theo createdAt, sổ 007..011, phone_1 thường', async () => {
      const { db, name } = newDb();
      const { statusId, customers } = await seedLegacy(db);
      const [c1, c2, c3, c4, c5] = customers;

      // Bước 6b: runner pre-up (007, 008, 009, 010); 011 post-up phải ở lại.
      const sixB = await reconcile(name, 'pre-up');
      expect(sixB.code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toEqual([
        ID_007,
        '008_crm_project_property_type_codes',
        '009_notification_attachment_indexes',
        ID_010,
      ]);
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);
      expect(await counterSeq(db)).toBe(0);
      // 007 đã điền statusCode cho khách cũ (ghi kép cùng id), không đụng mã khách/phone.
      for (const c of [c1, c2, c3, c4, c5]) {
        const row = await db.collection('customers').findOne({ _id: c._id });
        expect(row?.statusCode).toBe('NEW');
        expect(row?.statusId).toEqual(statusId);
        expect(row?.phone).toBe(c.phone);
        expect(row?.customerCode).toBeUndefined();
      }

      // Khoảng 6b -> up: image v1.0.3 tạo khách thiếu mã, vẫn thành công (index partial không chặn).
      await expect(
        oldImageCreates(db, 'gap-old', '+84900000006', day(6)),
      ).resolves.toMatchObject({ acknowledged: true });

      // `up` (8a/8b): pre-up chạy lại, không còn gì chờ.
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);

      // Backend mới sống: tạo khách có mã (counter 0 -> KH-000001, đi TRƯỚC khách cũ chưa bù: chấp nhận, Architecture).
      const newCode = await newBackendCreates(
        db,
        'new-backend',
        '+84900000007',
        day(7),
      );
      expect(newCode).toBe('KH-000001');
      // Cửa sổ trước 011 (đã được chấp nhận): trùng SĐT vẫn bị unique cũ chặn.
      await expect(
        db
          .collection('customers')
          .insertOne({ label: 'dup-phone', phone: '+84900000001' }),
      ).rejects.toMatchObject({ code: DUPLICATE_KEY });

      // Bước 20: bù mã (gồm cả xóa mềm/ẩn danh) theo createdAt, _id; nối sau mã backend đã lấy.
      const filled = await backfill(name);
      expect(filled.code).toBe(EXIT_CODE.OK);
      expect(filled.out).toContain('assigned=6, remaining=0, duplicates=0');
      expect(await codesByLabel(db)).toEqual({
        'new-backend': 'KH-000001',
        c1: 'KH-000002',
        'c2-anon': 'KH-000003',
        'c3-deleted': 'KH-000004',
        'c4-anon': 'KH-000005',
        c5: 'KH-000006',
        'gap-old': 'KH-000007',
      });
      await expectAllHaveUniqueCodes(db);
      expect(await counterSeq(db)).toBe(7);
      // 011 chưa chạy: phone vẫn unique và anonymized còn nguyên.
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);
      expect(
        await db
          .collection('customers')
          .countDocuments({ phone: { $regex: '^anonymized:' } }),
      ).toBe(2);

      // Bước 90: 011 một chiều.
      const ninety = await reconcile(name, 'post-up');
      expect(ninety.code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toEqual([
        ID_007,
        '008_crm_project_property_type_codes',
        '009_notification_attachment_indexes',
        ID_010,
        ID_011,
      ]);
      const phoneIndex = await indexByName(db, 'phone_1');
      expect(phoneIndex?.key).toEqual({ phone: 1 });
      expect(phoneIndex?.unique).toBeUndefined();
      expect(
        await db
          .collection('customers')
          .countDocuments({ phone: { $regex: '^anonymized:' } }),
      ).toBe(0);
      const anonymized = await db
        .collection('customers')
        .find({ label: { $in: ['c2-anon', 'c4-anon'] } })
        .toArray();
      expect(anonymized.map((a) => a.phone)).toEqual([null, null]);
      // Soft-delete giữ nguyên (mã vẫn do khách đã xóa mềm giữ, không bị cấp lại).
      expect(
        (await db.collection('customers').findOne({ _id: c3._id }))?.deletedAt,
      ).toEqual(day(21));
      expect(
        (await db.collection('customers').findOne({ _id: c3._id }))?.phone,
      ).toBe('+84900000003');

      // FR-01/FR-02: sau 011 tạo được nhiều khách không SĐT và hai khách cùng SĐT, mã vẫn cấp tiếp 8, 9, ...
      await expect(
        newBackendCreates(db, 'no-phone-1', null, day(9)),
      ).resolves.toBe('KH-000008');
      await expect(
        newBackendCreates(db, 'no-phone-2', null, day(10)),
      ).resolves.toBe('KH-000009');
      await expect(
        newBackendCreates(db, 'dup-phone', '+84900000001', day(11)),
      ).resolves.toBe('KH-000010');
    });

    it('FR-21: chạy lại TOÀN chuỗi không đổi gì (khách, index, counter, sổ); bù mã assigned=0', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      await oldImageCreatesAfterPreUp(name, db);
      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);

      const customersBefore = await snapshot(db);
      const indexesBefore = await indexes(db);
      const counterBefore = await counterSeq(db);
      const ledgerBefore = await ledger(db);

      const preAgain = await reconcile(name, 'pre-up');
      const fillAgain = await backfill(name);
      const postAgain = await reconcile(name, 'post-up');
      const allAgain = await reconcile(name, 'post-up');

      expect([preAgain.code, fillAgain.code, postAgain.code]).toEqual([
        EXIT_CODE.OK,
        EXIT_CODE.OK,
        EXIT_CODE.OK,
      ]);
      expect(allAgain.code).toBe(EXIT_CODE.OK);
      expect(fillAgain.out).toContain('assigned=0, remaining=0, duplicates=0');
      expect(await snapshot(db)).toEqual(customersBefore);
      expect(await indexes(db)).toEqual(indexesBefore);
      expect(await counterSeq(db)).toBe(counterBefore);
      expect(await ledger(db)).toEqual(ledgerBefore);
    });

    /** Dựng nhanh trạng thái sau 6b + một khách image cũ ghi chen (dùng cho ca không cần soi từng bước). */
    async function oldImageCreatesAfterPreUp(name: string, db: Db) {
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      await oldImageCreates(db, 'gap-old', '+84900000006', day(6));
    }

    it('FR-08: bù mã trên DB mẫu — khách xóa mềm và ẩn danh được cấp mã đúng thứ tự createdAt; counter = số khách', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);

      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);

      expect(await codesByLabel(db)).toEqual({
        c1: 'KH-000001',
        'c2-anon': 'KH-000002',
        'c3-deleted': 'KH-000003',
        'c4-anon': 'KH-000004',
        c5: 'KH-000005',
      });
      expect(await counterSeq(db)).toBe(5);
      const trace = await db
        .collection('system')
        .findOne({ _id: CUSTOMER_CODES_SCRIPT_DOC_ID } as never);
      expect(trace).toMatchObject({ assigned: 5, remaining: 0 });
    });
  });

  // ------------------------------------------------------------ cổng sổ 010

  describe('cổng sổ: script bù mã khi sổ chưa có 010', () => {
    it('FR-21: sổ trống (chưa deploy) -> thoát 0, không đụng khách/counter/doc vết, cả dry-run lẫn --apply', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      const before = await snapshot(db);

      for (const argv of [['--apply'], []]) {
        const res = await backfill(name, argv);
        expect(res.code).toBe(EXIT_CODE.OK);
        expect(res.out).toContain('chưa áp dụng');
      }

      expect(await snapshot(db)).toEqual(before);
      expect(await counterSeq(db)).toBeUndefined();
      expect(
        await db
          .collection('system')
          .findOne({ _id: CUSTOMER_CODES_SCRIPT_DOC_ID } as never),
      ).toBeNull();
      expect(await ledger(db)).toEqual([]);
    });

    it('FR-21: sổ mới có 007..009 (010 chưa ghi) -> vẫn thoát 0 không làm gì; sau khi 010 ghi sổ mới bù', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      // Mô phỏng `up` dừng trước 010: chạy riêng 007..009 qua registry rút gọn (cùng runner, cùng sổ).
      const partial = await runCli(
        ['up', '--apply', '--by', 'deploy', '--skip-version'],
        {
          mongoUri: replSet.getUri(name),
          migrations: MIGRATIONS.filter((m) => m.id < ID_010),
          app: APP,
          out: () => undefined,
          err: () => undefined,
        },
      );
      expect(partial).toBe(EXIT_CODE.OK);
      expect((await ledger(db)).includes(ID_010)).toBe(false);

      const res = await backfill(name);
      expect(res.code).toBe(EXIT_CODE.OK);
      expect(res.out).toContain('chưa áp dụng');
      expect(
        await db
          .collection('customers')
          .countDocuments({ customerCode: { $exists: true } }),
      ).toBe(0);

      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      await expectAllHaveUniqueCodes(db);
    });
  });

  // --------------------------------------------------- 010 với image cũ chen

  describe('010 khi image cũ chèn khách thiếu mã', () => {
    it('FR-21: khách thiếu mã có SẴN lúc 010 chạy (image cũ đã ghi chen trước `up`) -> 010 không lỗi, không đổi khách; bù mã sau đó bù đủ', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      // Trường hợp trong sổ: nhiều khách thiếu mã (không trường, null) tồn tại TRƯỚC khi index partial được tạo.
      await db.collection('customers').insertMany([
        { label: 'gap-1', phone: '+84900000011', createdAt: day(11) },
        {
          label: 'gap-null',
          phone: '+84900000012',
          createdAt: day(12),
          customerCode: null,
        },
      ]);
      const before = await snapshot(db);

      const sixB = await reconcile(name, 'pre-up');

      expect(sixB.code).toBe(EXIT_CODE.OK);
      expect(sixB.err).toBe('');
      expect(await indexByName(db, 'customerCode_1')).toBeDefined();
      // 010 không bù mã và không đụng khách; 007 chỉ thêm trường statusCode cho khách có statusId.
      const after = await snapshot(db);
      expect(after.map((r) => r.customerCode ?? null)).toEqual(
        before.map(() => null),
      );

      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      const codes = await expectAllHaveUniqueCodes(db);
      expect(codes).toHaveLength(7);
      expect(await counterSeq(db)).toBe(7);
    });
  });

  // ------------------------------------------------------- up lỗi rồi chạy lại

  describe('mô phỏng `up` lỗi rồi chạy lại (khoảng trống)', () => {
    it('FR-21: 010 lỗi vì index customerCode_1 xung đột -> runner thoát 1, bù mã khi sổ chưa có 010 thoát 0 không làm gì; sửa xong chạy lại: khách tạo trong khoảng trống vẫn được bù đủ, rồi 011', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      // Hỏng cố ý: index cùng tên nhưng KHÔNG partial (do người vận hành tạo tay) -> 010 từ chối, không tự xóa.
      await db
        .collection('customers')
        .createIndex(
          { customerCode: 1 },
          { name: 'customerCode_1', unique: true, sparse: true },
        );

      const failed = await reconcile(name, 'pre-up');
      expect(failed.code).toBe(EXIT_CODE.FAILURE);
      expect(failed.err).toMatch(/customerCode_1/);
      expect((await ledger(db)).includes(ID_010)).toBe(false);

      // Deploy dừng ở `up`; trong khoảng trống image cũ vẫn nhận khách mới (thiếu mã).
      await oldImageCreates(db, 'gap-during-failure', '+84900000021', day(21));
      // Nếu ai đó vẫn gọi bước 20: cổng sổ chặn, không ghi gì.
      const blocked = await backfill(name);
      expect(blocked.code).toBe(EXIT_CODE.OK);
      expect(blocked.out).toContain('chưa áp dụng');
      expect(await counterSeq(db)).toBeUndefined();
      expect(
        await db
          .collection('customers')
          .countDocuments({ customerCode: { $exists: true, $ne: null } }),
      ).toBe(0);

      // Người vận hành gỡ index hỏng, deploy lại: 010 thành công, một khách nữa tạo trong khoảng trống sau đó.
      await db.collection('customers').dropIndex('customerCode_1');
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      await oldImageCreates(db, 'gap-after-fix', '+84900000022', day(22));

      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      const codes = await expectAllHaveUniqueCodes(db);
      expect(codes).toHaveLength(7);
      const byLabel = await codesByLabel(db);
      expect(byLabel['gap-during-failure']).toBeDefined();
      expect(byLabel['gap-after-fix']).toBeDefined();
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toContain(ID_011);
    });

    it('FR-08, FR-21: bù mã dừng giữa chừng (sau lô 1) -> thoát 1 nên deploy KHÔNG chạy 011 (phone_1 còn unique); chạy lại nối tiếp, gồm khách chen vào, rồi 011', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);

      const interrupted = await backfill(name, ['--apply'], {
        batchSize: 2,
        afterBatch: ({ batch }) => {
          if (batch === 1) throw new Error('sự cố giả lập sau lô 1');
        },
      });
      expect(interrupted.code).toBe(EXIT_CODE.FAILURE);
      expect(interrupted.err).toContain('Chạy lại lệnh --apply');
      // Lô 1 đã commit (2 khách đầu theo createdAt), phần còn lại chưa.
      expect(await codesByLabel(db)).toMatchObject({
        c1: 'KH-000001',
        'c2-anon': 'KH-000002',
      });
      expect(
        await db
          .collection('customers')
          .countDocuments({ customerCode: { $not: { $type: 'string' } } }),
      ).toBe(3);
      // Deploy dừng ở bước 20 -> bước 90 chưa chạy: unique phone còn, đường lùi image còn nguyên.
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);
      expect((await ledger(db)).includes(ID_011)).toBe(false);

      // Khoảng trống: image cũ vẫn nhận khách thiếu mã giữa hai lần chạy.
      await oldImageCreates(db, 'gap-late', '+84900000031', day(31));

      const resumed = await backfill(name);
      expect(resumed.code).toBe(EXIT_CODE.OK);
      expect(resumed.out).toContain('remaining=0, duplicates=0');
      expect(await codesByLabel(db)).toEqual({
        c1: 'KH-000001',
        'c2-anon': 'KH-000002',
        'c3-deleted': 'KH-000003',
        'c4-anon': 'KH-000004',
        c5: 'KH-000005',
        'gap-late': 'KH-000006',
      });
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);
      expect((await indexByName(db, 'phone_1'))?.unique).toBeUndefined();
    });

    it('FR-21: `up` pre-up chạy lại sau khi 011 đã áp dụng (deploy lần hai) không làm hỏng gì', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);
      const before = await snapshot(db);

      const again = await reconcile(name, 'pre-up');

      expect(again.code).toBe(EXIT_CODE.OK);
      expect(await snapshot(db)).toEqual(before);
      expect((await indexByName(db, 'phone_1'))?.unique).toBeUndefined();
    });
  });

  // ------------------------------------------------- ca bổ sung (chuỗi, đối kháng)

  describe('ca bổ sung của chuỗi', () => {
    it('FR-21: SAU 010 image cũ ghi chen NHIỀU khách thiếu mã (không trường lẫn null) đều thành công; mã chuỗi trùng vẫn bị chặn; dry-run không ghi; --apply bù đủ', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);

      // Partial index chỉ tính mã dạng chuỗi: hai khách thiếu mã trở lên không được đụng E11000.
      await oldImageCreates(db, 'gap-a', '+84900000041', day(41));
      await oldImageCreates(db, 'gap-b', '+84900000042', day(42));
      await db.collection('customers').insertOne({
        label: 'gap-null',
        phone: '+84900000043',
        createdAt: day(43),
        customerCode: null,
      });
      await db.collection('customers').insertOne({
        label: 'gap-null-2',
        phone: '+84900000044',
        createdAt: day(44),
        customerCode: null,
      });
      // Unique vẫn hiệu lực với mã dạng chuỗi (partial không làm mất ràng buộc).
      await db.collection('customers').insertOne({
        label: 'coded',
        phone: '+84900000045',
        customerCode: 'KH-900001',
      });
      await expect(
        db.collection('customers').insertOne({
          label: 'coded-dup',
          phone: '+84900000046',
          customerCode: 'KH-900001',
        }),
      ).rejects.toMatchObject({ code: DUPLICATE_KEY });

      // Dry-run: báo số thiếu (5 cũ + 4 chen = 9), không ghi gì.
      const before = await snapshot(db);
      const dry = await backfill(name, []);
      expect(dry.code).toBe(EXIT_CODE.OK);
      expect(dry.out).toContain('Khách thiếu mã: 9');
      expect(await snapshot(db)).toEqual(before);
      expect(await counterSeq(db)).toBe(0);

      // --apply: counter đồng bộ với KH-900001 rồi cấp tiếp, thứ tự createdAt.
      const applied = await backfill(name);
      expect(applied.code).toBe(EXIT_CODE.OK);
      expect(applied.out).toContain('assigned=9, remaining=0, duplicates=0');
      const codes = await expectAllHaveUniqueCodes(db);
      expect(codes).toHaveLength(10);
      expect(await counterSeq(db)).toBe(900010);
      const byLabel = await codesByLabel(db);
      expect(byLabel.coded).toBe('KH-900001');
      expect(byLabel.c1).toBe('KH-900002');
      expect(byLabel['gap-null-2']).toBe('KH-900010');
    });

    it('FR-07, FR-21: backend mới tạo khách GIỮA hai lần chạy bù mã bị gián đoạn -> mã không trùng, không thủng, khách bù tiếp nối sau', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);

      const interrupted = await backfill(name, ['--apply'], {
        batchSize: 2,
        afterBatch: ({ batch }) => {
          if (batch === 1) throw new Error('sự cố giả lập sau lô 1');
        },
      });
      expect(interrupted.code).toBe(EXIT_CODE.FAILURE);
      // Lô 1 đã cấp KH-000001..2, counter = 2; backend mới lấy số kế tiếp từ counter.
      await expect(
        newBackendCreates(db, 'new-between', null, day(50)),
      ).resolves.toBe('KH-000003');

      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      expect(await codesByLabel(db)).toEqual({
        c1: 'KH-000001',
        'c2-anon': 'KH-000002',
        'new-between': 'KH-000003',
        'c3-deleted': 'KH-000004',
        'c4-anon': 'KH-000005',
        c5: 'KH-000006',
      });
      expect(await counterSeq(db)).toBe(6);
      await expectAllHaveUniqueCodes(db);
    });

    it('FR-21: cài mới (DB trống): 8a pre-up -> bù mã 0 việc (thoát 0) -> 90 post-up; sổ đủ 007..011, tạo khách không SĐT/trùng SĐT được ngay', async () => {
      const { db, name } = newDb();

      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      const filled = await backfill(name);
      expect(filled.code).toBe(EXIT_CODE.OK);
      expect(filled.out).toContain('assigned=0, remaining=0, duplicates=0');
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);

      expect(await ledger(db)).toEqual([
        ID_007,
        '008_crm_project_property_type_codes',
        '009_notification_attachment_indexes',
        ID_010,
        ID_011,
      ]);
      expect((await indexByName(db, 'customerCode_1'))?.unique).toBe(true);
      expect((await indexByName(db, 'phone_1'))?.unique).toBeUndefined();
      await expect(newBackendCreates(db, 'first', null, day(1))).resolves.toBe(
        'KH-000001',
      );
      await expect(newBackendCreates(db, 'second', null, day(2))).resolves.toBe(
        'KH-000002',
      );
    });

    /**
     * Quy tắc pha HAI CHIỀU (Architecture 5.7; `findPhaseOrderViolation` trong migration-phase.ts): `--phase post-up` bị
     * từ chối khi còn migration pre-up số NHỎ HƠN chờ. Nếu không, 011 (bỏ unique phone, một chiều) sẽ ghi sổ khi 010 chưa
     * chạy; lần `reconcile` sau bị `findLedgerGap` từ chối ("007 chưa chạy nhưng migration sau nó đã vào sổ") nên các pre-up
     * chờ không bao giờ áp dụng được bằng runner. Tình huống xảy ra khi bỏ sót 6b hoặc chạy tay (deploy.sh luôn chạy pre-up
     * trước bước 90).
     */
    it('FR-21: --phase post-up chạy khi 010 CHƯA ghi sổ (bỏ sót 6b) -> bị từ chối (mã 1), không ghi 011; sau đó reconcile pre-up vẫn áp dụng được', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);

      const res = await reconcile(name, 'post-up');

      expect(res.code).toBe(EXIT_CODE.FAILURE);
      expect(res.err).toContain('--phase pre-up');
      expect(await ledger(db)).not.toContain(ID_011);
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);

      // Sổ không bị lỗ hổng: reconcile pre-up chạy được (không bị findLedgerGap từ chối), sau đó mới tới 011.
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toContain(ID_010);
      expect(await ledger(db)).not.toContain(ID_011);
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toContain(ID_011);
      expect((await indexByName(db, 'phone_1'))?.unique).toBeUndefined();
    });
  });

  // ----------------------------------------------- khớp index schema <-> hằng số

  describe('khớp index schema Mongoose <-> hằng số migration (FR-07, FR-02)', () => {
    const schemaIndexOn = (field: string) =>
      CustomerSchema.indexes().find(
        ([fields]) => Object.keys(fields).join(',') === field,
      );

    it('FR-07: schema khai báo đúng một index {customerCode:1} khớp từng tùy chọn của CUSTOMER_CODE_INDEX', () => {
      const matches = CustomerSchema.indexes().filter(
        ([fields]) => 'customerCode' in fields,
      );
      expect(matches).toHaveLength(1);
      const [fields, options] = matches[0];
      expect(fields).toEqual(CUSTOMER_CODE_INDEX.key);
      expect(options).toMatchObject({
        name: CUSTOMER_CODE_INDEX.options.name,
        unique: CUSTOMER_CODE_INDEX.options.unique,
        partialFilterExpression:
          CUSTOMER_CODE_INDEX.options.partialFilterExpression,
      });
      // Không thêm tùy chọn lạ (sparse/collation/TTL) làm lệch so với migration 010.
      expect(Object.keys(options as object).sort()).toEqual([
        'name',
        'partialFilterExpression',
        'unique',
      ]);
    });

    it('FR-02: schema KHÔNG khai báo index nào theo phone (phone_1 do migration 011 sở hữu, không autoIndex tái tạo unique)', () => {
      expect(
        CustomerSchema.indexes().filter(([fields]) => 'phone' in fields),
      ).toEqual([]);
      expect(schemaIndexOn('phone')).toBeUndefined();
    });

    it('FR-07, FR-21: index do migration 010 tạo trên Mongo thật == index Mongoose tự đồng bộ (createIndexes không IndexOptionsConflict, không tạo thêm customerCode_1 thứ hai)', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      const migrated = await indexByName(db, 'customerCode_1');

      const connection = await mongoose
        .createConnection(replSet.getUri(name), { autoIndex: false })
        .asPromise();
      try {
        const model = connection.model(
          'CustomerChain',
          CustomerSchema,
          'customers',
        );
        await expect(model.createIndexes()).resolves.toBeUndefined();
      } finally {
        await connection.close();
      }

      const afterSync = await indexByName(db, 'customerCode_1');
      expect(afterSync).toEqual(migrated);
      expect(
        (await indexes(db)).filter((i) => 'customerCode' in (i.key as object)),
      ).toHaveLength(1);
      // Mongoose không dựng lại phone_1 unique (011 chưa chạy -> vẫn là index unique cũ do seed, không bị đổi).
      expect((await indexByName(db, 'phone_1'))?.unique).toBe(true);
    });

    it('FR-02, FR-22: sau 011, Mongoose createIndexes không biến phone_1 trở lại unique và không tạo index phone nào khác', async () => {
      const { db, name } = newDb();
      await seedLegacy(db);
      expect((await reconcile(name, 'pre-up')).code).toBe(EXIT_CODE.OK);
      expect((await backfill(name)).code).toBe(EXIT_CODE.OK);
      expect((await reconcile(name, 'post-up')).code).toBe(EXIT_CODE.OK);

      const connection = await mongoose
        .createConnection(replSet.getUri(name), { autoIndex: false })
        .asPromise();
      try {
        const model = connection.model(
          'CustomerChain',
          CustomerSchema,
          'customers',
        );
        await model.createIndexes();
      } finally {
        await connection.close();
      }

      const phoneIndexes = (await indexes(db)).filter(
        (i) => 'phone' in (i.key as object),
      );
      expect(phoneIndexes.map((i) => i.name)).toEqual(['phone_1']);
      expect(phoneIndexes[0].unique).toBeUndefined();
      // Và hai khách cùng SĐT vẫn tạo được (không unique nào còn trên phone).
      await expect(
        db.collection('customers').insertMany([
          { label: 'x', phone: '+84900000001' },
          { label: 'y', phone: '+84900000001' },
        ]),
      ).resolves.toMatchObject({ insertedCount: 2 });
    });
  });
});
