/**
 * INTEGRATION - pha migration (`--phase`, FR-21) trên MongoDB replica set thật (mongodb-memory-server). Chạy bằng
 * `npm run test:integration`. Gọi qua `runCli` để phủ cả phân tích cờ, mã thoát và JSON; kiểm trên TRẠNG THÁI DB THẬT
 * (collection `system` và collection `probe` do migration mẫu ghi).
 */
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCli } from './cli-app';
import { EXIT_CODE } from './migration-runner';
import type { ReconcileReport } from './migration-runner';
import type { Migration, MigrationPhase } from './migration.types';

jest.setTimeout(240_000);

const APP = { version: '1.0.5', commit: 'abc1234' };

interface RunResult {
  code: number;
  out: string[];
  err: string;
}

describe('MigrationRunner theo pha (--phase) trên replica set (FR-21)', () => {
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
    const name = `phase_${dbCounter}`;
    return { db: client.db(name), uri: replSet.getUri(name) };
  };

  /** Dựng migration mẫu ghi thứ tự chạy vào `calls`; `phase` bỏ trống = mặc định pre-up. */
  const sample = (
    id: string,
    calls: string[],
    phase?: MigrationPhase,
  ): Migration => ({
    id,
    description: `mẫu ${id}`,
    ...(phase ? { phase } : {}),
    up: async ({ db }) => {
      calls.push(id);
      await db
        .collection('probe')
        .updateOne(
          { _id: id } as never,
          { $set: { done: true } },
          { upsert: true },
        );
    },
  });

  /** 007 (mặc định pre-up), 008 pre-up, 009 post-up (hình dáng như deploy 010 pre-up + 011 post-up). */
  const buildMigrations = (calls: string[]): Migration[] => [
    sample('007_sample_pre', calls),
    sample('008_sample_pre', calls, 'pre-up'),
    sample('009_sample_post', calls, 'post-up'),
  ];

  /** 008 post-up chờ nhỏ hơn 009 pre-up chờ (tình huống bản sau thêm pre-up số lớn). */
  const buildCrossed = (calls: string[]): Migration[] => [
    sample('007_sample_pre', calls),
    sample('008_sample_post', calls, 'post-up'),
    sample('009_sample_pre', calls),
  ];

  const run = async (
    uri: string,
    migrations: readonly Migration[],
    argv: string[],
  ): Promise<RunResult> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      mongoUri: uri,
      migrations,
      app: APP,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { code, out, err: err.join('\n') };
  };

  /** Các id đã vào sổ (`migration:<id>`), không tính khóa/version/lỗi. */
  const ledger = async (db: Db): Promise<string[]> =>
    (await db.collection('system').find().toArray())
      .map((doc) => String(doc._id))
      .filter((id) => id.startsWith('migration:'))
      .sort();

  const APPLY = ['--apply', '--by', 'deploy'];

  it('FR-21: reconcile --phase pre-up chạy 007, 008; 009 post-up để lại, rồi --phase post-up chạy 009', async () => {
    const { db, uri } = newDb();
    const calls: string[] = [];
    const migrations = buildMigrations(calls);

    const pre = await run(uri, migrations, [
      'reconcile',
      ...APPLY,
      '--skip-version',
      '--phase',
      'pre-up',
    ]);
    expect(pre.code).toBe(EXIT_CODE.OK);
    expect(calls).toEqual(['007_sample_pre', '008_sample_pre']);
    expect(await ledger(db)).toEqual([
      'migration:007_sample_pre',
      'migration:008_sample_pre',
    ]);

    const post = await run(uri, migrations, [
      'reconcile',
      ...APPLY,
      '--skip-version',
      '--phase',
      'post-up',
    ]);
    expect(post.code).toBe(EXIT_CODE.OK);
    expect(calls).toEqual([
      '007_sample_pre',
      '008_sample_pre',
      '009_sample_post',
    ]);
    expect(await ledger(db)).toHaveLength(3);
  });

  it('FR-21: chạy lại cùng pha là idempotent (không gọi lại migration, sổ không đổi)', async () => {
    const { db, uri } = newDb();
    const calls: string[] = [];
    const migrations = buildMigrations(calls);
    const argv = ['reconcile', ...APPLY, '--skip-version', '--phase', 'pre-up'];

    await run(uri, migrations, argv);
    const before = await ledger(db);
    const again = await run(uri, migrations, argv);

    expect(again.code).toBe(EXIT_CODE.OK);
    expect(calls).toEqual(['007_sample_pre', '008_sample_pre']);
    expect(await ledger(db)).toEqual(before);
  });

  it('FR-21: --phase all (mặc định) chạy đủ theo thứ tự số', async () => {
    const { db, uri } = newDb();
    const calls: string[] = [];

    const result = await run(uri, buildMigrations(calls), [
      'reconcile',
      ...APPLY,
    ]);

    expect(result.code).toBe(EXIT_CODE.OK);
    expect(calls).toEqual([
      '007_sample_pre',
      '008_sample_pre',
      '009_sample_post',
    ]);
    expect(await ledger(db)).toHaveLength(3);
  });

  it('FR-21: dry-run --phase pre-up không ghi gì và liệt kê đúng migration pre-up', async () => {
    const { db, uri } = newDb();
    const calls: string[] = [];

    const result = await run(uri, buildMigrations(calls), [
      'reconcile',
      '--json',
      '--phase',
      'pre-up',
    ]);
    const report = JSON.parse(result.out[0]) as ReconcileReport;

    expect(result.code).toBe(EXIT_CODE.OK);
    expect(report.plan?.migrations).toEqual([
      '007_sample_pre',
      '008_sample_pre',
    ]);
    expect(calls).toEqual([]);
    expect(await db.listCollections().toArray()).toHaveLength(0);
  });

  describe('quy tắc từ chối pre-up khi còn post-up nhỏ hơn', () => {
    /** Đưa 007 vào sổ trước (bản deploy cũ) để chỉ còn 008 post-up + 009 pre-up chờ. */
    const seedFirst = async (uri: string, calls: string[]): Promise<void> => {
      const first = await run(uri, buildCrossed(calls).slice(0, 1), [
        'reconcile',
        ...APPLY,
        '--skip-version',
      ]);
      expect(first.code).toBe(EXIT_CODE.OK);
      calls.length = 0;
    };

    it('FR-21: reconcile --apply --phase pre-up => mã 1, "chạy --phase post-up trước", không chạy, không ghi sổ', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      await seedFirst(uri, calls);
      const before = await ledger(db);

      const result = await run(uri, buildCrossed(calls), [
        'reconcile',
        ...APPLY,
        '--skip-version',
        '--json',
        '--phase',
        'pre-up',
      ]);
      const report = JSON.parse(result.out[0]) as ReconcileReport;

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(report).toMatchObject({ result: 'refused', exitCode: 1 });
      expect(result.err).toContain('--phase post-up');
      expect(calls).toEqual([]);
      expect(await ledger(db)).toEqual(before);
    });

    it('FR-21: dry-run trả cùng mã 1 như --apply', async () => {
      const { uri } = newDb();
      const calls: string[] = [];
      await seedFirst(uri, calls);

      const result = await run(uri, buildCrossed(calls), [
        'reconcile',
        '--skip-version',
        '--phase',
        'pre-up',
      ]);

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.err).toContain('--phase post-up');
    });

    it('FR-21: lệnh up --apply --phase pre-up cũng bị từ chối (mã 1)', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      await seedFirst(uri, calls);
      const before = await ledger(db);

      const result = await run(uri, buildCrossed(calls), [
        'up',
        '--apply',
        '--by',
        'deploy',
        '--phase',
        'pre-up',
      ]);

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.err).toContain('--phase post-up');
      expect(calls).toEqual([]);
      expect(await ledger(db)).toEqual(before);
    });

    it('FR-21: lối thoát - chạy --phase post-up trước rồi --phase pre-up thì thành công', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      await seedFirst(uri, calls);
      const base = ['reconcile', ...APPLY, '--skip-version'];

      const post = await run(uri, buildCrossed(calls), [
        ...base,
        '--phase',
        'post-up',
      ]);
      const pre = await run(uri, buildCrossed(calls), [
        ...base,
        '--phase',
        'pre-up',
      ]);

      expect(post.code).toBe(EXIT_CODE.OK);
      expect(pre.code).toBe(EXIT_CODE.OK);
      expect(calls).toEqual(['008_sample_post', '009_sample_pre']);
      expect(await ledger(db)).toHaveLength(3);
    });
  });

  it('FR-21: status in cột pha và số migration chờ post-up; --json có trường phase', async () => {
    const { uri } = newDb();
    const text = await run(uri, buildMigrations([]), ['status']);
    const json = await run(uri, buildMigrations([]), ['status', '--json']);
    const parsed = JSON.parse(json.out[0]) as {
      pending: Array<{ id: string; phase: string }>;
    };

    expect(text.out.join('\n')).toContain('009_sample_post [post-up]');
    expect(text.out.join('\n')).toContain('007_sample_pre [pre-up]');
    expect(text.out).toContain('Chờ post-up: 1');
    expect(parsed.pending.map(({ phase }) => phase)).toEqual([
      'pre-up',
      'pre-up',
      'post-up',
    ]);
  });
});
