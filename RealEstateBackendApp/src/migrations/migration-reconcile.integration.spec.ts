/**
 * INTEGRATION — lệnh `reconcile` (PT-027 tự baseline + tự migrate theo version) trên MongoDB replica set thật
 * (mongodb-memory-server). Chạy bằng `npm run test:integration` (không nằm trong `npm test`). Gọi qua `runCli` để phủ
 * cả phân tích lệnh, mã thoát và dòng JSON duy nhất. Mọi kết luận đều kiểm trên TRẠNG THÁI DB THẬT (collection
 * `system` và dữ liệu nghiệp vụ), không chỉ mã thoát.
 */
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCli } from './cli-app';
import { EXIT_CODE } from './migration-runner';
import type { ReconcileReport } from './migration-runner';
import * as migrationState from './migration-state';
import type { Migration } from './migration.types';
import {
  BREAKERS,
  seedProductionLikeDb,
  snapshotDb,
} from './production-like-db.fixture';
import { BASELINE_MIGRATION_IDS } from './system.constants';

jest.setTimeout(240_000);

const APP = { version: '1.0.3', commit: 'abc1234' };
const BASELINE_DOC_IDS = BASELINE_MIGRATION_IDS.map((id) => `migration:${id}`);

interface RunResult {
  code: number;
  out: string[];
  err: string;
  /** Dòng JSON duy nhất của `--json` (null nếu stdout không có đúng một dòng). */
  report: ReconcileReport | null;
}

describe('MigrationRunner.reconcile (CLI) trên replica set', () => {
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

  const newDb = (): { name: string; db: Db; uri: string } => {
    dbCounter += 1;
    const name = `pt027r_${dbCounter}`;
    return { name, db: client.db(name), uri: replSet.getUri(name) };
  };

  const buildMigrations = (
    calls: string[],
    overrides: Record<string, () => Promise<void>> = {},
  ): Migration[] =>
    ['007_sample_one', '008_sample_two', '009_sample_three'].map((id) => ({
      id,
      description: `mẫu ${id}`,
      up: async ({ db, log }) => {
        calls.push(id);
        log(`đang chạy ${id}`);
        if (overrides[id]) return overrides[id]();
        await db
          .collection('probe')
          .updateOne(
            { _id: id } as never,
            { $set: { done: true } },
            { upsert: true },
          );
      },
    }));

  const run = async (
    uri: string,
    migrations: readonly Migration[],
    argv: string[],
    app: { version: string; commit: string | null } = APP,
  ): Promise<RunResult> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(['reconcile', ...argv], {
      mongoUri: uri,
      migrations,
      app,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    const report =
      argv.includes('--json') && out.length === 1
        ? (JSON.parse(out[0]) as ReconcileReport)
        : null;
    return { code, out, err: err.join('\n'), report };
  };

  const APPLY = ['--apply', '--by', 'deploy'];

  const systemDoc = (db: Db, id: string) =>
    db.collection('system').findOne({ _id: id } as never);
  const systemIds = async (db: Db) =>
    (await db.collection('system').find().toArray())
      .map((doc) => String(doc._id))
      .sort();
  /** Ảnh chụp mọi collection NGOÀI `system` (dữ liệu nghiệp vụ không được đổi bởi reconcile). */
  const businessSnapshot = async (db: Db) => {
    const snapshot = await snapshotDb(db);
    delete snapshot.system;
    return snapshot;
  };

  describe('kịch bản 1: DB trống', () => {
    it('apply: chỉ ghi version, không baseline, không probe; JSON đúng một dòng', async () => {
      const { db, uri } = newDb();
      const result = await run(uri, [], [...APPLY, '--json']);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.out).toHaveLength(1);
      expect(result.report).toMatchObject({
        mode: 'apply',
        result: 'ok',
        exitCode: 0,
        appVersion: '1.0.3',
        systemVersion: null,
        applied: true,
        probes: [],
        plan: { baseline: [], migrations: [], versionToWrite: '1.0.3' },
      });
      expect(await systemIds(db)).toEqual(['version']);
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: '1.0.3',
        commit: 'abc1234',
      });
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });

    it('dry-run (mặc định): không ghi gì, không tạo collection, vẫn in kế hoạch', async () => {
      const { db, uri } = newDb();
      const result = await run(uri, [], ['--json']);
      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.report).toMatchObject({
        mode: 'dry-run',
        applied: false,
        plan: { versionToWrite: '1.0.3' },
      });
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });
  });

  describe('kịch bản 2: production giả (users đủ dữ liệu, system trống) lên 1.0.3', () => {
    it('dry-run: probe đạt, báo sẽ baseline 5 id, KHÔNG ghi gì', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const before = await snapshotDb(db);

      const dry = await run(uri, [], ['--json']);

      expect(dry.code).toBe(EXIT_CODE.OK);
      expect(dry.report?.plan?.baseline).toEqual([...BASELINE_MIGRATION_IDS]);
      expect(dry.report?.probes.every((p) => p.passed)).toBe(true);
      expect(await snapshotDb(db)).toEqual(before);
    });

    it('apply: ledger 002..006 by=baseline kèm evidence (chỉ số đếm), version 1.0.3, dữ liệu nghiệp vụ không đổi', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const businessBefore = await businessSnapshot(db);

      const result = await run(uri, [], [...APPLY, '--json']);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(await systemIds(db)).toEqual([...BASELINE_DOC_IDS, 'version']);
      for (const id of BASELINE_DOC_IDS) {
        const doc = (await systemDoc(db, id)) as unknown as {
          by: string;
          evidence: Record<string, unknown>;
        };
        expect(doc.by).toBe('baseline');
        expect(Object.keys(doc.evidence).length).toBeGreaterThan(0);
        expect(
          Object.values(doc.evidence).every((v) => typeof v === 'number'),
        ).toBe(true);
      }
      // Evidence phản ánh dữ liệu thật đã dựng (2 bài mỗi collection, 34 tỉnh giữ nguyên).
      expect(
        await systemDoc(db, 'migration:002_recompute_urlhash_sha256'),
      ).toMatchObject({
        evidence: { raw_articles_scanned: 2, news_articles_scanned: 2 },
      });
      expect(
        await systemDoc(db, 'migration:006_areas_34_provinces'),
      ).toMatchObject({
        evidence: { provincesKept: 34, provincesInserted: 0 },
      });
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: '1.0.3',
        commit: 'abc1234',
      });
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(await businessSnapshot(db)).toEqual(businessBefore);
      expect(result.report).toMatchObject({ applied: true, result: 'ok' });
    });

    it('--skip-version: baseline được ghi nhưng version KHÔNG; sau đó `up` không còn bị chặn mã 4 (baselineRequired đã sửa)', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);

      const first = await run(uri, [], [...APPLY, '--skip-version']);
      expect(first.code).toBe(EXIT_CODE.OK);
      expect(await systemDoc(db, 'version')).toBeNull();
      expect(await systemIds(db)).toEqual(BASELINE_DOC_IDS.slice().sort());

      const out: string[] = [];
      const err: string[] = [];
      const status = await runCli(['status', '--json'], {
        mongoUri: uri,
        migrations: [],
        app: APP,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      });
      expect(status).toBe(EXIT_CODE.OK);
      expect(JSON.parse(out[0])).toMatchObject({
        baselineRequired: false,
        systemVersion: null,
      });

      const upCode = await runCli(['up', '--apply', '--by', 'deploy'], {
        mongoUri: uri,
        migrations: [],
        app: APP,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      });
      expect(upCode).toBe(EXIT_CODE.OK);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
    });

    it('registry có 007..009: baseline trước, rồi 007 -> 008 -> 009 (by=deploy), rồi version', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const calls: string[] = [];

      const result = await run(uri, buildMigrations(calls), [...APPLY]);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(calls).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemIds(db)).toEqual(
        [
          ...BASELINE_DOC_IDS,
          'migration:007_sample_one',
          'migration:008_sample_two',
          'migration:009_sample_three',
          'version',
        ].sort(),
      );
      expect(await systemDoc(db, 'migration:007_sample_one')).toMatchObject({
        by: 'deploy',
      });
      expect(
        await systemDoc(db, 'migration:005_users_roles_teamids'),
      ).toMatchObject({ by: 'baseline' });
    });

    it('stdout --json: đúng MỘT dòng dù migration có log; log tiến trình ra stderr', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const result = await run(uri, buildMigrations([]), [...APPLY, '--json']);

      expect(result.out).toHaveLength(1);
      expect(result.out[0].startsWith('{')).toBe(true);
      expect(result.err).toContain('đang chạy 007_sample_one');
      expect(result.err).toContain('Baseline 002_recompute_urlhash_sha256');
      expect(result.report?.plan?.migrations).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemDoc(db, 'version')).not.toBeNull();
    });
  });

  describe('kịch bản 3: probe fail -> dừng mã 4, KHÔNG ghi gì', () => {
    it.each(Object.keys(BREAKERS))(
      'dữ liệu còn việc cho %s: mã 4 ở cả dry-run lẫn apply, system không bị tạo, nêu đúng id fail',
      async (brokenId) => {
        const { db, uri } = newDb();
        await seedProductionLikeDb(db);
        await BREAKERS[brokenId](db);
        const before = await snapshotDb(db);
        const calls: string[] = [];

        const apply = await run(uri, buildMigrations(calls), [
          ...APPLY,
          '--json',
        ]);
        const dry = await run(uri, buildMigrations(calls), ['--json']);

        for (const result of [apply, dry]) {
          expect(result.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
          expect(result.report?.result).toBe('probe_failed');
          expect(result.report?.applied).toBe(false);
          expect(
            result.report?.probes.filter((p) => !p.passed).map((p) => p.id),
          ).toEqual([brokenId]);
          expect(result.err).toContain(brokenId);
        }
        expect(calls).toEqual([]);
        // Không `system`, không khóa, không đổi dữ liệu: ảnh chụp toàn DB giữ nguyên.
        expect(await snapshotDb(db)).toEqual(before);
        expect(await db.listCollections({ name: 'system' }).toArray()).toEqual(
          [],
        );
      },
    );

    it('user thiếu roles (probe 005 fail): không tự chạy backfill, user vẫn thiếu roles', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      await db
        .collection('users')
        .insertOne({ email: 'x@example.test', role: 'STAFF', teamId: null });

      const result = await run(uri, [], APPLY);

      expect(result.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      const stale = await db
        .collection('users')
        .findOne({ email: 'x@example.test' });
      expect(stale).not.toHaveProperty('roles');
    });
  });

  describe('kịch bản 4: đã đúng 1.0.3 -> không làm gì (idempotent)', () => {
    it('chạy apply hai lần: lần 2 và lần 3 là noop, sổ và version giữ nguyên từng byte', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      expect((await run(uri, [], APPLY)).code).toBe(EXIT_CODE.OK);
      const systemBefore = await db
        .collection('system')
        .find({})
        .sort({ _id: 1 })
        .toArray();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const again = await run(uri, [], [...APPLY, '--json']);
        expect(again.code).toBe(EXIT_CODE.OK);
        expect(again.report).toMatchObject({
          result: 'ok',
          applied: false,
          systemVersion: '1.0.3',
          plan: { noop: true, baseline: [], migrations: [] },
        });
      }
      expect(
        await db.collection('system').find({}).sort({ _id: 1 }).toArray(),
      ).toEqual(systemBefore);
    });
  });

  describe('kịch bản 5: app mới hơn DB, có migration chờ', () => {
    const seedLedger = async (db: Db, version: string | null) => {
      await db.collection('system').insertMany(
        BASELINE_DOC_IDS.map((_id) => ({
          _id,
          at: new Date('2026-01-01'),
          by: 'baseline',
        })) as never,
      );
      if (version) {
        await db.collection('system').insertOne({
          _id: 'version',
          value: version,
          commit: null,
          updatedAt: new Date('2026-01-01'),
        } as never);
      }
    };

    it('DB 1.0.2, app 1.0.3, registry 007..009: chạy theo thứ tự rồi ghi 1.0.3', async () => {
      const { db, uri } = newDb();
      await seedLedger(db, '1.0.2');
      const calls: string[] = [];

      const result = await run(uri, buildMigrations(calls), [
        ...APPLY,
        '--json',
      ]);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(calls).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
      expect(result.report).toMatchObject({ systemVersion: '1.0.2' });
    });

    it('--skip-version: chạy migration nhưng GIỮ version cũ; lần sau (không skip) chỉ ghi version, không chạy lại migration', async () => {
      const { db, uri } = newDb();
      await seedLedger(db, '1.0.2');
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const first = await run(uri, migrations, [...APPLY, '--skip-version']);
      expect(first.code).toBe(EXIT_CODE.OK);
      expect(calls).toHaveLength(3);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.2' });

      const second = await run(uri, migrations, [...APPLY]);
      expect(second.code).toBe(EXIT_CODE.OK);
      expect(calls).toHaveLength(3);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
    });

    it('cùng version nhưng có migration mới: vẫn chạy, cảnh báo, không đổi version', async () => {
      const { db, uri } = newDb();
      await seedLedger(db, '1.0.3');
      const calls: string[] = [];

      const result = await run(uri, buildMigrations(calls), [
        ...APPLY,
        '--json',
      ]);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(calls).toHaveLength(3);
      expect(result.report?.warnings.join(' ')).toContain('cùng version');
      expect(await systemDoc(db, 'version')).toMatchObject({
        updatedAt: new Date('2026-01-01'),
      });
    });

    it('DB có version nhưng sổ THIẾU 002..006: tin version, không probe, không ghi baseline', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      // Ép một probe sẽ fail nếu bị chạy nhầm: nó không được ảnh hưởng vì version đã có.
      await BREAKERS['005_users_roles_teamids'](db);
      await db.collection('system').insertOne({
        _id: 'version',
        value: '1.0.2',
        commit: null,
        updatedAt: new Date('2026-01-01'),
      } as never);

      const result = await run(uri, [], [...APPLY, '--json']);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.report?.probes).toEqual([]);
      expect(await systemIds(db)).toEqual(['version']);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
    });
  });

  describe('kịch bản 6: downgrade (app cũ hơn DB)', () => {
    it('mã 5 ở cả dry-run lẫn apply, không migrate, không hạ version, không ghi gì', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertOne({
        _id: 'version',
        value: '1.0.4',
        commit: 'ffff000',
        updatedAt: new Date('2026-02-02'),
      } as never);
      const before = await snapshotDb(db);
      const calls: string[] = [];

      const apply = await run(uri, buildMigrations(calls), [
        ...APPLY,
        '--json',
      ]);
      const dry = await run(uri, buildMigrations(calls), ['--json']);

      for (const result of [apply, dry]) {
        expect(result.code).toBe(EXIT_CODE.DOWNGRADE);
        expect(result.report).toMatchObject({
          result: 'downgrade',
          exitCode: 5,
          applied: false,
          systemVersion: '1.0.4',
        });
        expect(result.err).toContain('1.0.4');
      }
      expect(calls).toEqual([]);
      expect(await snapshotDb(db)).toEqual(before);
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: '1.0.4',
        commit: 'ffff000',
      });
    });
  });

  describe('kịch bản 7: khóa mồ côi', () => {
    it('mã 3 (cả dry-run, apply), không làm gì; `unlock` rồi chạy được', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      await db.collection('system').insertOne({
        _id: 'migration-lock',
        at: new Date(),
        by: 'deploy',
      } as never);

      const apply = await run(uri, [], [...APPLY, '--json']);
      const dry = await run(uri, [], ['--json']);
      expect(apply.code).toBe(EXIT_CODE.LOCKED);
      expect(dry.code).toBe(EXIT_CODE.LOCKED);
      expect(apply.report?.result).toBe('locked');
      expect(await systemIds(db)).toEqual(['migration-lock']);

      const out: string[] = [];
      await runCli(['unlock'], {
        mongoUri: uri,
        migrations: [],
        app: APP,
        out: (line) => out.push(line),
        err: () => undefined,
      });
      expect(out.join()).toContain('Đã gỡ khóa');
      expect((await run(uri, [], APPLY)).code).toBe(EXIT_CODE.OK);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
    });
  });

  describe('kịch bản 8: chạy lại sau khi chết giữa chừng', () => {
    it('baseline dở (đã ghi 002..004): chỉ probe + ghi 005, 006; bản ghi cũ giữ nguyên, không nhân đôi', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const oldAt = new Date('2026-01-01');
      for (const id of BASELINE_DOC_IDS.slice(0, 3)) {
        await db.collection('system').insertOne({
          _id: id,
          at: oldAt,
          by: 'baseline',
          evidence: { marker: 1 },
        } as never);
      }

      const result = await run(uri, [], [...APPLY, '--json']);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.report?.probes.map((p) => p.id)).toEqual([
        '005_users_roles_teamids',
        '006_areas_34_provinces',
      ]);
      expect(await systemIds(db)).toEqual([...BASELINE_DOC_IDS, 'version']);
      expect(
        await systemDoc(db, 'migration:002_recompute_urlhash_sha256'),
      ).toEqual({
        _id: 'migration:002_recompute_urlhash_sha256',
        at: oldAt,
        by: 'baseline',
        evidence: { marker: 1 },
      });
    });

    it('baseline dở và probe của id còn thiếu fail: dừng mã 4, không ghi thêm', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      await BREAKERS['006_areas_34_provinces'](db);
      for (const id of BASELINE_DOC_IDS.slice(0, 4)) {
        await db.collection('system').insertOne({
          _id: id,
          at: new Date('2026-01-01'),
          by: 'baseline',
        } as never);
      }
      const before = await snapshotDb(db);

      const result = await run(uri, [], APPLY);

      expect(result.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(await snapshotDb(db)).toEqual(before);
    });

    it('sổ đủ 002..006 + 007, version null (chết sau pha migrate): chỉ chạy 008, 009 rồi ghi version', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      await db.collection('system').insertMany(
        [...BASELINE_DOC_IDS, 'migration:007_sample_one'].map((_id) => ({
          _id,
          at: new Date('2026-01-01'),
          by: 'baseline',
        })) as never,
      );
      const calls: string[] = [];

      const result = await run(uri, buildMigrations(calls), [...APPLY]);

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(calls).toEqual(['008_sample_two', '009_sample_three']);
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
    });

    it('007 lỗi sau baseline: baseline đã ghi, KHÔNG ghi version, last-error có, mã 1; sửa xong chạy lại hoàn tất, không nhân đôi', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const calls: string[] = [];
      const failing = (): Promise<void> =>
        Promise.reject(new Error('hỏng 007'));

      const first = await run(
        uri,
        buildMigrations(calls, { '007_sample_one': failing }),
        [...APPLY, '--json'],
      );

      expect(first.code).toBe(EXIT_CODE.FAILURE);
      expect(first.report).toMatchObject({ result: 'failed', applied: true });
      expect(calls).toEqual(['007_sample_one']);
      expect(await systemDoc(db, 'version')).toBeNull();
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(await systemDoc(db, 'migration:007_sample_one')).toBeNull();
      expect(await systemDoc(db, 'migration-last-error')).toMatchObject({
        migrationId: '007_sample_one',
      });
      const baselineAt = (
        (await systemDoc(db, BASELINE_DOC_IDS[0])) as unknown as { at: Date }
      ).at;

      const retryCalls: string[] = [];
      const second = await run(uri, buildMigrations(retryCalls), [...APPLY]);

      expect(second.code).toBe(EXIT_CODE.OK);
      expect(retryCalls).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemDoc(db, 'migration-last-error')).toBeNull();
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:')),
      ).toHaveLength(8);
      expect(
        ((await systemDoc(db, BASELINE_DOC_IDS[0])) as unknown as { at: Date })
          .at,
      ).toEqual(baselineAt);
    });
  });

  describe('kịch bản 9: sổ không liền mạch', () => {
    it('008 đã vào sổ mà 007 chưa: mã 1, không chạy gì, không ghi gì', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertMany([
        {
          _id: 'version',
          value: '1.0.2',
          commit: null,
          updatedAt: new Date('2026-01-01'),
        },
        { _id: 'migration:008_sample_two', at: new Date(), by: 'cli' },
      ] as never);
      const before = await snapshotDb(db);
      const calls: string[] = [];

      const result = await run(uri, buildMigrations(calls), [
        ...APPLY,
        '--json',
      ]);

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.report?.result).toBe('refused');
      expect(result.err).toContain('007_sample_one');
      expect(calls).toEqual([]);
      expect(await snapshotDb(db)).toEqual(before);
    });

    it('version trong DB sai định dạng: mã 1, không ghi gì', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertOne({
        _id: 'version',
        value: 'không-phải-semver',
        commit: null,
        updatedAt: new Date('2026-01-01'),
      } as never);
      const before = await snapshotDb(db);

      const result = await run(uri, [], [...APPLY, '--json']);

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.report?.result).toBe('refused');
      expect(await snapshotDb(db)).toEqual(before);
    });
  });

  describe('kịch bản 10: song song và đọc lại sau khóa', () => {
    it('hai reconcile --apply đồng thời: baseline ghi đúng một lần, mỗi migration chạy đúng một lần', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const [a, b] = await Promise.all([
        run(uri, migrations, [...APPLY]),
        run(uri, migrations, ['--apply', '--by', 'cli']),
      ]);

      expect([EXIT_CODE.OK, EXIT_CODE.LOCKED]).toContain(a.code);
      expect([EXIT_CODE.OK, EXIT_CODE.LOCKED]).toContain(b.code);
      expect([a.code, b.code]).toContain(EXIT_CODE.OK);
      expect([...calls].sort()).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:')),
      ).toHaveLength(8);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
    });

    it('trạng thái đổi giữa lúc đọc và lúc giành khóa: đọc lại SAU khóa thấy đã xong nên không ghi/chạy gì thêm', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      expect((await run(uri, [], APPLY)).code).toBe(EXIT_CODE.OK);
      const systemBefore = await db
        .collection('system')
        .find({})
        .sort({ _id: 1 })
        .toArray();

      // Lần đọc ĐẦU (trước khóa) trả ảnh chụp cũ "cần baseline, chưa có version"; các lần sau đọc thật.
      const realRead = migrationState.readMigrationState;
      const spy = jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementationOnce(() =>
          Promise.resolve({
            version: null,
            applied: [],
            lock: null,
            lastError: null,
            baselineRequired: true,
            hasUsers: true,
          }),
        )
        .mockImplementation(realRead);
      try {
        // Registry rỗng: kế hoạch trước khóa (theo ảnh chụp cũ) là "ghi baseline 5 id + version" nên KHÔNG noop và đi
        // vào giành khóa; đọc lại sau khóa thấy sổ đã đủ, version đã khớp => noop, không ghi đè gì.
        const result = await run(uri, [], [...APPLY, '--json']);
        expect(result.code).toBe(EXIT_CODE.OK);
        expect(result.report?.applied).toBe(false);
        expect(result.report?.plan).toMatchObject({ noop: true });
      } finally {
        spy.mockRestore();
      }
      expect(
        await db.collection('system').find({}).sort({ _id: 1 }).toArray(),
      ).toEqual(systemBefore);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });

    it('dữ liệu hỏng đi SAU lần probe trước khóa: probe chạy lại sau khóa, dừng mã 4, không ghi baseline, khóa được nhả', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);

      const realRead = migrationState.readMigrationState;
      let reads = 0;
      const spy = jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementation(async (target) => {
          reads += 1;
          // Lần đọc thứ 2 = ngay sau khi giữ khóa: làm hỏng dữ liệu trước khi probe lần hai chạy.
          if (reads === 2) await BREAKERS['004_users_add_team_id'](db);
          return realRead(target);
        });
      try {
        const result = await run(uri, [], [...APPLY, '--json']);
        expect(result.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
        expect(result.report?.result).toBe('probe_failed');
        // Kế hoạch lập trước khóa (baseline 5 id + version) không được sót lại trong report bị từ chối sau khóa.
        expect(result.report?.plan).toBeNull();
        expect(result.report?.applied).toBe(false);
        expect(
          result.report?.probes.filter((p) => !p.passed).map((p) => p.id),
        ).toEqual(['004_users_add_team_id']);
      } finally {
        spy.mockRestore();
      }
      expect(reads).toBe(2);
      expect(await systemIds(db)).toEqual([]);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });
  });

  describe('kịch bản 11: không phải replica set', () => {
    it('apply VÀ dry-run đều mã 1 (dry-run báo trước apply sẽ bị từ chối), không ghi gì', async () => {
      const standalone = await MongoMemoryServer.create();
      const standaloneClient = new MongoClient(standalone.getUri());
      try {
        await standaloneClient.connect();
        const db = standaloneClient.db('pt027r_standalone');
        await seedProductionLikeDb(db);
        const before = await snapshotDb(db);
        const uri = standalone.getUri('pt027r_standalone');

        const apply = await run(uri, [], [...APPLY, '--json']);
        const dry = await run(uri, [], ['--json']);

        expect(apply.code).toBe(EXIT_CODE.FAILURE);
        expect(apply.report?.result).toBe('refused');
        expect(apply.err).toContain('replica set');
        expect(dry.code).toBe(EXIT_CODE.FAILURE);
        expect(dry.report?.result).toBe('refused');
        expect(dry.report?.probes.every((p) => p.passed)).toBe(true);
        expect(await snapshotDb(db)).toEqual(before);
      } finally {
        await standaloneClient.close();
        await standalone.stop();
      }
    });
  });

  describe('hợp đồng deploy.sh: dry-run (--by deploy --skip-version --json) trả CÙNG mã thoát với --apply', () => {
    const scenarios: Array<{
      name: string;
      expected: number;
      setup: (db: Db) => Promise<void>;
    }> = [
      {
        name: 'ok có việc (production giả chờ baseline)',
        expected: EXIT_CODE.OK,
        setup: (db) => seedProductionLikeDb(db),
      },
      {
        name: 'ok DB trống (có migration chờ, bỏ qua version)',
        expected: EXIT_CODE.OK,
        setup: () => Promise.resolve(),
      },
      {
        name: 'có khóa',
        expected: EXIT_CODE.LOCKED,
        setup: async (db) => {
          await db.collection('system').insertOne({
            _id: 'migration-lock',
            at: new Date(),
            by: 'cli',
          } as never);
        },
      },
      {
        name: 'probe fail (cần xử lý tay)',
        expected: EXIT_CODE.BASELINE_REQUIRED,
        setup: async (db) => {
          await seedProductionLikeDb(db);
          await BREAKERS['002_recompute_urlhash_sha256'](db);
        },
      },
      {
        name: 'downgrade',
        expected: EXIT_CODE.DOWNGRADE,
        setup: async (db) => {
          await db.collection('system').insertOne({
            _id: 'version',
            value: '9.9.9',
            commit: null,
            updatedAt: new Date(),
          } as never);
        },
      },
      {
        name: 'sổ không liền mạch',
        expected: EXIT_CODE.FAILURE,
        setup: async (db) => {
          await db.collection('system').insertOne({
            _id: 'migration:008_sample_two',
            at: new Date(),
            by: 'cli',
          } as never);
        },
      },
      {
        name: 'version DB sai định dạng',
        expected: EXIT_CODE.FAILURE,
        setup: async (db) => {
          await db.collection('system').insertOne({
            _id: 'version',
            value: 'rác',
            commit: null,
            updatedAt: new Date(),
          } as never);
        },
      },
    ];

    it.each(scenarios)('$name', async ({ expected, setup }) => {
      const { db, uri } = newDb();
      await setup(db);
      const migrations = buildMigrations([]);
      const flags = ['--by', 'deploy', '--skip-version', '--json'];

      const dry = await run(uri, migrations, flags);
      const apply = await run(uri, migrations, ['--apply', ...flags]);

      expect(dry.code).toBe(expected);
      expect(apply.code).toBe(expected);
      expect(dry.report?.exitCode).toBe(expected);
      expect(dry.out).toHaveLength(1);
    });
  });

  describe('DB mới + --skip-version (kịch bản QA): version ghi ngay, bước sau không coi là production cũ', () => {
    it('reconcile --apply --skip-version trên DB mới ghi version; có user đầu tiên rồi chạy lại => noop mã 0, không probe, không baseline', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      // Bước 6b của deploy: DB mới, users rỗng, system trống.
      const first = await run(uri, migrations, [
        ...APPLY,
        '--skip-version',
        '--json',
      ]);
      expect(first.code).toBe(EXIT_CODE.OK);
      expect(first.report).toMatchObject({
        applied: true,
        plan: { versionToWrite: '1.0.3' },
      });
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: '1.0.3',
        commit: 'abc1234',
      });
      expect(calls).toHaveLength(3);

      // Backend khởi động và tạo user đầu tiên.
      await db.collection('users').insertOne({ email: 'first@example.test' });
      const systemBefore = await db
        .collection('system')
        .find({})
        .sort({ _id: 1 })
        .toArray();

      // Bước 8b: reconcile lần 2 phải noop.
      const second = await run(uri, migrations, [...APPLY, '--json']);
      expect(second.code).toBe(EXIT_CODE.OK);
      expect(second.report).toMatchObject({
        result: 'ok',
        applied: false,
        probes: [],
        plan: { baseline: [], migrations: [], noop: true },
      });
      expect(calls).toHaveLength(3);
      expect(
        await db.collection('system').find({}).sort({ _id: 1 }).toArray(),
      ).toEqual(systemBefore);
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:00')),
      ).toEqual([
        'migration:007_sample_one',
        'migration:008_sample_two',
        'migration:009_sample_three',
      ]);
    });

    it('production cũ (users có dữ liệu) với --skip-version vẫn KHÔNG ghi version (chỉ DB mới tinh mới được ép)', async () => {
      const { db, uri } = newDb();
      await seedProductionLikeDb(db);
      const result = await run(uri, [], [...APPLY, '--skip-version', '--json']);
      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.report?.plan?.versionToWrite).toBeNull();
      expect(await systemDoc(db, 'version')).toBeNull();
    });
  });

  describe('DB mới: trạng thái đổi giữa lúc đọc trước khóa và lúc đọc lại sau khóa', () => {
    it('user xuất hiện sau lần đọc đầu: đọc lại sau khóa thấy hasUsers => KHÔNG ép ghi version, probe fail mã 4, report sạch (plan=null, không cảnh báo cũ)', async () => {
      const { db, uri } = newDb();
      const realRead = migrationState.readMigrationState;
      let reads = 0;
      const spy = jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementation(async (target) => {
          reads += 1;
          // Lần đọc thứ 2 = ngay sau khi giữ khóa: backend vừa tạo user đầu tiên (chưa có roles/teamIds).
          if (reads === 2) {
            await db
              .collection('users')
              .insertOne({ email: 'racer@example.test' });
          }
          return realRead(target);
        });
      let result: RunResult;
      try {
        result = await run(uri, [], [...APPLY, '--skip-version', '--json']);
      } finally {
        spy.mockRestore();
      }

      expect(reads).toBe(2);
      expect(result.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(result.report).toMatchObject({
        result: 'probe_failed',
        exitCode: 4,
        applied: false,
        plan: null,
      });
      // Trước khóa kế hoạch là "ép ghi version 1.0.3"; sau khóa bị từ chối nên KHÔNG được ghi gì.
      expect(await systemIds(db)).toEqual([]);
      expect(await systemDoc(db, 'version')).toBeNull();
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });

    it('bị từ chối (downgrade) SAU khóa: report không còn kế hoạch và cảnh báo của lần lập trước khóa', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertOne({
        _id: 'version',
        value: '9.9.9',
        commit: null,
        updatedAt: new Date('2026-02-02'),
      } as never);
      // Lần đọc ĐẦU (trước khóa) trả ảnh chụp "cùng version 1.0.3, sổ đủ, có migration chờ" => READY kèm cảnh báo
      // "cùng version nhưng có migration mới"; lần đọc lại sau khóa là DB thật (9.9.9) => downgrade.
      const realRead = migrationState.readMigrationState;
      const spy = jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementationOnce(() =>
          Promise.resolve({
            version: { value: '1.0.3', commit: null, updatedAt: new Date() },
            applied: BASELINE_MIGRATION_IDS.map((id) => ({
              id,
              at: new Date(),
              by: 'baseline' as const,
            })),
            lock: null,
            lastError: null,
            baselineRequired: false,
            hasUsers: true,
          }),
        )
        .mockImplementation(realRead);
      const calls: string[] = [];
      let result: RunResult;
      try {
        result = await run(uri, buildMigrations(calls), [...APPLY, '--json']);
      } finally {
        spy.mockRestore();
      }

      expect(result.code).toBe(EXIT_CODE.DOWNGRADE);
      expect(result.report).toMatchObject({
        result: 'downgrade',
        plan: null,
        warnings: [],
        probes: [],
        applied: false,
      });
      expect(calls).toEqual([]);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '9.9.9' });
    });

    it('users rỗng nhưng sổ đã có bản ghi dở (002, 003): ghi version, KHÔNG ghi thêm baseline; lần 2 sau khi có user là noop', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertMany([
        {
          _id: 'migration:002_recompute_urlhash_sha256',
          at: new Date('2026-01-01'),
          by: 'baseline',
        },
        {
          _id: 'migration:003_drop_googledrivetokens_ttl_index',
          at: new Date('2026-01-01'),
          by: 'baseline',
        },
      ] as never);

      const first = await run(uri, [], [...APPLY, '--skip-version', '--json']);

      expect(first.code).toBe(EXIT_CODE.OK);
      expect(first.report?.plan).toMatchObject({
        baseline: [],
        versionToWrite: '1.0.3',
      });
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.3' });
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:')),
      ).toHaveLength(2);

      await db.collection('users').insertOne({ email: 'u@example.test' });
      const before = await db
        .collection('system')
        .find({})
        .sort({ _id: 1 })
        .toArray();
      const second = await run(uri, [], [...APPLY, '--json']);
      expect(second.code).toBe(EXIT_CODE.OK);
      expect(second.report).toMatchObject({
        probes: [],
        plan: { noop: true },
      });
      expect(
        await db.collection('system').find({}).sort({ _id: 1 }).toArray(),
      ).toEqual(before);
    });

    it('dry-run --skip-version trên DB mới báo versionToWrite và không ghi gì', async () => {
      const { db, uri } = newDb();
      const result = await run(
        uri,
        [],
        ['--by', 'deploy', '--skip-version', '--json'],
      );
      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.report?.plan?.versionToWrite).toBe('1.0.3');
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });
  });

  describe('baseline thủ công dùng cùng quy tắc version với reconcile', () => {
    it.each([
      '1.0.3-rc..1',
      '1.0.3-rc.',
      '1.0.3+b.',
      '1.0.3-.',
      '1.0.03',
      'abc',
    ])('--version "%s": mã 2, không ghi gì', async (version) => {
      const { db, uri } = newDb();
      await db.collection('users').insertOne({ email: 'a@example.test' });
      const before = await snapshotDb(db);

      const code = await runCli(['baseline', '--apply', '--version', version], {
        mongoUri: uri,
        migrations: [],
        app: APP,
        out: () => undefined,
        err: () => undefined,
      });

      expect(code).toBe(EXIT_CODE.USAGE);
      expect(await snapshotDb(db)).toEqual(before);
    });

    it('--version hợp lệ có pre-release/build (1.0.3-rc.1+b.5) vẫn được nhận', async () => {
      const { db, uri } = newDb();
      await db.collection('users').insertOne({ email: 'a@example.test' });
      const code = await runCli(
        ['baseline', '--apply', '--version', '1.0.3-rc.1+b.5'],
        {
          mongoUri: uri,
          migrations: [],
          app: APP,
          out: () => undefined,
          err: () => undefined,
        },
      );
      expect(code).toBe(EXIT_CODE.OK);
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: '1.0.3-rc.1+b.5',
      });
    });
  });

  describe('`up` thủ công chặn downgrade', () => {
    const runUp = async (
      uri: string,
      migrations: readonly Migration[],
      argv: string[],
    ) => {
      const err: string[] = [];
      const code = await runCli(['up', ...argv], {
        mongoUri: uri,
        migrations,
        app: APP,
        out: () => undefined,
        err: (line) => err.push(line),
      });
      return { code, err: err.join('\n') };
    };

    it('DB 1.0.4, app 1.0.3: `up --apply` và `up` (dry-run) trả mã 5, không chạy migration, không hạ version, không ghi gì', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertOne({
        _id: 'version',
        value: '1.0.4',
        commit: 'ffff000',
        updatedAt: new Date('2026-02-02'),
      } as never);
      const before = await snapshotDb(db);
      const calls: string[] = [];

      const apply = await runUp(uri, buildMigrations(calls), ['--apply']);
      const dry = await runUp(uri, buildMigrations(calls), []);

      expect(apply.code).toBe(EXIT_CODE.DOWNGRADE);
      expect(dry.code).toBe(EXIT_CODE.DOWNGRADE);
      expect(apply.err).toContain('downgrade');
      expect(calls).toEqual([]);
      expect(await snapshotDb(db)).toEqual(before);
    });

    it('version DB cao hơn lộ ra giữa lúc đọc và lúc giành khóa: đọc lại sau khóa vẫn chặn, nhả khóa', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertOne({
        _id: 'version',
        value: '1.0.4',
        commit: null,
        updatedAt: new Date('2026-02-02'),
      } as never);
      const realRead = migrationState.readMigrationState;
      const spy = jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementationOnce(() =>
          Promise.resolve({
            version: { value: '1.0.2', commit: null, updatedAt: new Date() },
            applied: [],
            lock: null,
            lastError: null,
            baselineRequired: false,
            hasUsers: false,
          }),
        )
        .mockImplementation(realRead);
      const calls: string[] = [];
      try {
        const result = await runUp(uri, buildMigrations(calls), ['--apply']);
        expect(result.code).toBe(EXIT_CODE.DOWNGRADE);
      } finally {
        spy.mockRestore();
      }
      expect(calls).toEqual([]);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.4' });
    });

    it('app == DB vẫn chạy bình thường', async () => {
      const { db, uri } = newDb();
      await db.collection('system').insertOne({
        _id: 'version',
        value: '1.0.3',
        commit: null,
        updatedAt: new Date('2026-02-02'),
      } as never);
      const calls: string[] = [];
      const result = await runUp(uri, buildMigrations(calls), ['--apply']);
      expect(result.code).toBe(EXIT_CODE.OK);
      expect(calls).toHaveLength(3);
    });
  });

  describe('cú pháp và JSON', () => {
    it('--json khi lỗi runner (registry hỏng): vẫn đúng một dòng JSON result=error, mã 1, không ghi gì', async () => {
      const { db, uri } = newDb();
      const broken = buildMigrations([]).filter(
        (m) => m.id !== '008_sample_two',
      );

      const result = await run(uri, broken, [...APPLY, '--json']);

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.report).toMatchObject({ result: 'error', exitCode: 1 });
      expect(result.err).toContain('Registry migration không hợp lệ');
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });

    it('không --json: không in JSON ra stdout', async () => {
      const { uri } = newDb();
      const result = await run(uri, [], [...APPLY]);
      expect(result.out.some((line) => line.startsWith('{'))).toBe(false);
      expect(result.out.join('\n')).toContain('Hoàn tất reconcile');
    });
  });
});
