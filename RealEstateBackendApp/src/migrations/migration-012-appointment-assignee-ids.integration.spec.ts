/**
 * INTEGRATION — T-61 (FR-30): migration 012 `012_crm_appointment_assignee_ids` chạy trên MongoDB Replica Set của
 * mongodb-memory-server (động cơ mongod thật nhưng KHÔNG phải replica set `rs0` production), qua `runCli` với registry THẬT.
 * Bổ sung cho spec đơn vị (`FakeMongo`): bulkWrite thật, hơn một lô 500, bản ghi hỏng, idempotent hai lần chạy,
 * và chuỗi deploy bước 6b (pre-up) rồi bước 90 (post-up) khi sổ có 010 đã chạy, 011 và 012 còn chờ.
 *
 * Chạy: npx jest --testPathIgnorePatterns "/node_modules/" --testRegex "migration-012-appointment-assignee-ids.integration.spec.ts$" --runInBand
 */
import { MongoClient, ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.fixture';
import { backfillAppointmentAssigneeIds } from './backfill-appointment-assignee-ids';
import { runCli } from './cli-app';
import { EXIT_CODE } from './migration-runner';
import { MIGRATIONS } from './migration.registry';
import type { ReconcileReport } from './migration-runner';
import { snapshotDb } from './production-like-db.fixture';
import { BASELINE_MIGRATION_IDS } from './system.constants';

jest.setTimeout(240_000);

const APP = { version: '1.0.6', commit: 'abc1234' };
const ID_010 = '010_crm_customer_code_index';
const ID_011 = '011_crm_drop_unique_phone';
const ID_012 = '012_crm_appointment_assignee_ids';
const APPLIED_BEFORE = [...BASELINE_MIGRATION_IDS, '007_crm_catalog_codes'];

describe('migration 012 (appointments.assigneeIds) trên replica set của mongodb-memory-server', () => {
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

  const newDb = (): { db: Db; uri: string } => {
    dbCounter += 1;
    const name = `t61m012_${dbCounter}`;
    return { db: client.db(name), uri: replSet.getUri(name) };
  };

  const idOf = (n: number) => new ObjectId(n.toString(16).padStart(24, '0'));
  const userA = idOf(901);
  const userB = idOf(902);

  const reconcile = async (uri: string, argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(['reconcile', ...argv], {
      mongoUri: uri,
      migrations: MIGRATIONS,
      app: APP,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    const report =
      out.length === 1 ? (JSON.parse(out[0]) as ReconcileReport) : null;
    return { code, out, err: err.join('\n'), report };
  };
  const APPLY = ['--apply', '--by', 'deploy', '--skip-version', '--json'];

  const ledger = async (db: Db) =>
    (await db.collection('system').find().toArray())
      .map((doc) => String(doc._id))
      .filter((id) => id.startsWith('migration:'))
      .map((id) => id.slice('migration:'.length))
      .sort();

  /** Sổ như production sau bước 10/20 của v1.0.5: baseline + 007..010 đã chạy; 011 (post-up) và 012 (post-up) còn chờ. */
  const seedLedger = async (db: Db, applied: string[]) => {
    await db.collection('system').insertMany([
      {
        _id: 'version',
        value: '1.0.5',
        commit: null,
        updatedAt: new Date(),
      },
      ...applied.map((id) => ({
        _id: `migration:${id}`,
        at: new Date('2026-01-01T00:00:00Z'),
        by: 'deploy',
      })),
    ] as never);
  };

  const legacyAppointments = (count: number, firstId = 1) =>
    Array.from({ length: count }, (_, i) => ({
      _id: idOf(firstId + i),
      title: `Lịch ${firstId + i}`,
      assigneeId: userA,
    }));

  describe('backfill trực tiếp (bulkWrite thật)', () => {
    it('hơn 500 lịch (1203) kèm bản ghi hỏng và bản ghi đã có assigneeIds: trả { backfilled, skipped }, không ghi đè, giữ assigneeId, tạo index; chạy lần hai không ghi gì', async () => {
      const { db } = newDb();
      const appointments = db.collection('appointments');
      await appointments.insertMany([
        ...legacyAppointments(1203),
        // đã do BE mới ghi kép, assigneeId lệch: KHÔNG bị ghi đè
        {
          _id: idOf(5000),
          assigneeId: userA,
          assigneeIds: [userB, userA],
        },
        // chuỗi 24 hex hợp lệ: ép ObjectId
        { _id: idOf(5001), assigneeId: userB.toHexString() },
        // thiếu / null: rỗng thật
        { _id: idOf(5002) },
        { _id: idOf(5003), assigneeId: null },
        // hỏng: bị bỏ qua, KHÔNG biến thành []
        { _id: idOf(5004), assigneeId: 'khong-hop-le' },
        { _id: idOf(5005), assigneeId: 12345 },
        { _id: idOf(5006), assigneeId: { $oid: 'x' } },
      ] as never);

      const logs: string[] = [];
      const first = await backfillAppointmentAssigneeIds(db, (m) =>
        logs.push(m),
      );
      // 1203 + hex + thiếu + null = 1206 được điền; 3 hỏng bị bỏ qua.
      expect(first).toMatchObject({ backfilled: 1206, skipped: 3 });
      expect(first.indexCreated).toBe(true);
      expect(logs.filter((m) => m.includes('CẢNH BÁO'))).toHaveLength(3);

      expect(
        await appointments.countDocuments({
          _id: { $lte: idOf(1203) },
          assigneeIds: [userA],
          assigneeId: userA,
        }),
      ).toBe(1203);
      expect(
        (await appointments.findOne({ _id: idOf(5000) }))!.assigneeIds,
      ).toEqual([userB, userA]);
      expect(
        (await appointments.findOne({ _id: idOf(5001) }))!.assigneeIds,
      ).toEqual([userB]);
      expect(
        (await appointments.findOne({ _id: idOf(5002) }))!.assigneeIds,
      ).toEqual([]);
      expect(
        (await appointments.findOne({ _id: idOf(5003) }))!.assigneeIds,
      ).toEqual([]);
      for (const n of [5004, 5005, 5006]) {
        expect(
          'assigneeIds' in (await appointments.findOne({ _id: idOf(n) }))!,
        ).toBe(false);
      }
      const indexes = (await appointments.listIndexes().toArray()).map(
        (index) => index.name,
      );
      expect(indexes).toContain('assigneeIds_1_startAt_1');

      const before = await snapshotDb(db);
      const second = await backfillAppointmentAssigneeIds(db);
      expect(second).toMatchObject({ backfilled: 0, skipped: 3 });
      expect(second.indexCreated).toBe(false);
      expect(await snapshotDb(db)).toEqual(before);
    });
  });

  describe('chuỗi deploy: bước 6b pre-up rồi bước 90 post-up (FR-30)', () => {
    const seedFixture = async (db: Db) => {
      await seedLedger(db, [
        ...APPLIED_BEFORE,
        '008_crm_project_property_type_codes',
        '009_notification_attachment_indexes',
        ID_010,
      ]);
      await db
        .collection('appointments')
        .insertMany([
          ...legacyAppointments(700),
          { _id: idOf(9000), assigneeId: 'hong' },
        ] as never);
    };

    it('pre-up: không REFUSED, mã 0, KHÔNG ghi gì (ảnh chụp DB trước/sau bằng nhau); post-up: chạy 011 rồi 012, backfill lịch cũ; chạy lại là noop', async () => {
      const { db, uri } = newDb();
      await seedFixture(db);
      const before = await snapshotDb(db);

      const pre = await reconcile(uri, [...APPLY, '--phase', 'pre-up']);
      expect(pre.code).toBe(EXIT_CODE.OK);
      expect(pre.report?.plan?.migrations ?? []).toEqual([]);
      expect(pre.report?.applied).toBe(false);
      expect(await snapshotDb(db)).toEqual(before);
      expect(await ledger(db)).not.toContain(ID_011);
      expect(await ledger(db)).not.toContain(ID_012);

      const post = await reconcile(uri, [...APPLY, '--phase', 'post-up']);
      expect(post.code).toBe(EXIT_CODE.OK);
      expect(post.report?.plan?.migrations).toEqual([ID_011, ID_012]);
      const applied = await db
        .collection('system')
        .find({
          _id: { $in: [`migration:${ID_011}`, `migration:${ID_012}`] },
        } as never)
        .toArray();
      expect(applied).toHaveLength(2);
      const at = (id: string) =>
        (
          applied.find((doc) => String(doc._id) === `migration:${id}`)!
            .at as Date
        ).getTime();
      expect(at(ID_011)).toBeLessThanOrEqual(at(ID_012));

      const appointments = db.collection('appointments');
      expect(await appointments.countDocuments({ assigneeIds: [userA] })).toBe(
        700,
      );
      expect(
        'assigneeIds' in (await appointments.findOne({ _id: idOf(9000) }))!,
      ).toBe(false);
      expect(
        (await appointments.listIndexes().toArray()).map((index) => index.name),
      ).toContain('assigneeIds_1_startAt_1');

      const afterPost = await snapshotDb(db);
      const again = await reconcile(uri, [...APPLY, '--phase', 'post-up']);
      expect(again.code).toBe(EXIT_CODE.OK);
      expect(again.report?.plan?.migrations ?? []).toEqual([]);
      expect(await snapshotDb(db)).toEqual(afterPost);
    });

    it('đối chứng: pha mặc định (all) cũng chạy đúng 011 rồi 012 và cho kết quả giống hệt', async () => {
      const { db, uri } = newDb();
      await seedFixture(db);
      const all = await reconcile(uri, APPLY);
      expect(all.code).toBe(EXIT_CODE.OK);
      expect(await ledger(db)).toEqual(
        expect.arrayContaining([ID_011, ID_012]),
      );
      expect(
        await db
          .collection('appointments')
          .countDocuments({ assigneeIds: [userA] }),
      ).toBe(700);
    });
  });
});
