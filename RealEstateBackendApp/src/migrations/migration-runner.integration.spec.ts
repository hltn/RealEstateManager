/**
 * INTEGRATION — runner migration PT-027 (collection `system`) trên MongoDB replica set thật (mongodb-memory-server).
 * Chạy bằng `npm run test:integration` (không nằm trong `npm test`). Gọi qua `runCli` để phủ cả phần phân tích lệnh
 * lẫn mã thoát. Tiêu chí deploy.sh/Dockerfile (nghiệm thu 6) thuộc devops, không có ở đây.
 */
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { createMemoryReplSet } from '../shared/database/memory-replset.util';
import { runCli } from './cli-app';
import { EXIT_CODE } from './migration-runner';
import * as migrationState from './migration-state';
import type { Migration } from './migration.types';

jest.setTimeout(240_000);

const APP = { version: '1.0.3', commit: 'abc1234' };

interface RunResult {
  code: number;
  out: string;
  err: string;
}

describe('MigrationRunner (CLI) trên replica set', () => {
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

  /** Mỗi test một database riêng để không ảnh hưởng nhau. */
  const newDb = (): { name: string; db: Db; uri: string } => {
    dbCounter += 1;
    const name = `pt027_${dbCounter}`;
    return { name, db: client.db(name), uri: replSet.getUri(name) };
  };

  /** Dựng 3 migration mẫu 007..009 ghi lại thứ tự chạy; `overrides` thay hàm `up` theo id. */
  const buildMigrations = (
    calls: string[],
    overrides: Record<string, () => Promise<void>> = {},
  ): Migration[] =>
    ['007_sample_one', '008_sample_two', '009_sample_three'].map((id) => ({
      id,
      description: `mẫu ${id}`,
      up: async ({ db }) => {
        calls.push(id);
        if (overrides[id]) return overrides[id]();
        await db.collection('probe').updateOne(
          { _id: id } as never,
          { $set: { done: true } },
          {
            upsert: true,
          },
        );
      },
    }));

  const run = async (
    uri: string,
    migrations: readonly Migration[],
    ...argv: string[]
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
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  const systemDoc = (db: Db, id: string) =>
    db.collection('system').findOne({ _id: id } as never);
  const systemIds = async (db: Db) =>
    (await db.collection('system').find().toArray())
      .map((doc) => String(doc._id))
      .sort();

  describe('tiêu chí 1: status và dry-run không ghi gì; --apply bị từ chối nếu không phải replica set', () => {
    it('status và up (dry-run) không tạo collection, không chạy migration', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const status = await run(uri, migrations, 'status');
      const dry = await run(uri, migrations, 'up');
      const baselineDry = await run(
        uri,
        migrations,
        'baseline',
        '--version',
        '1.0.2',
        '--commit',
        'e6099c0',
      );

      expect(status.code).toBe(EXIT_CODE.OK);
      expect(dry.code).toBe(EXIT_CODE.OK);
      expect(baselineDry.code).toBe(EXIT_CODE.OK);
      expect(dry.out).toContain('DRY-RUN');
      expect(dry.out).toContain('007_sample_one');
      expect(calls).toEqual([]);
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });

    it('status --json trả JSON hợp lệ với danh sách chờ', async () => {
      const { uri } = newDb();
      const { code, out } = await run(
        uri,
        buildMigrations([]),
        'status',
        '--json',
      );
      expect(code).toBe(EXIT_CODE.OK);
      const parsed = JSON.parse(out) as {
        appVersion: string;
        pending: Array<{ id: string }>;
        replicaSet: boolean;
        baselineRequired: boolean;
      };
      expect(parsed.appVersion).toBe(APP.version);
      expect(parsed.pending.map((p) => p.id)).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(parsed.replicaSet).toBe(true);
      expect(parsed.baselineRequired).toBe(false);
    });

    it('hợp đồng với deploy.sh: status --json là MỘT dòng bắt đầu bằng "{", đủ trường, "pending":[] khi hết việc, mã 3/4 khớp', async () => {
      const { db, uri } = newDb();
      const migrations = buildMigrations([]);

      // Còn việc chờ: một dòng JSON, đủ mọi trường deploy.sh/vận hành đọc.
      const pendingRun = await run(uri, migrations, 'status', '--json');
      expect(pendingRun.out.split('\n')).toHaveLength(1);
      expect(pendingRun.out.startsWith('{')).toBe(true);
      expect(
        Object.keys(
          JSON.parse(pendingRun.out) as Record<string, unknown>,
        ).sort(),
      ).toEqual(
        [
          'appCommit',
          'appVersion',
          'applied',
          'baselineRequired',
          'lastError',
          'locked',
          'pending',
          'replicaSet',
          'systemVersion',
        ].sort(),
      );
      expect(pendingRun.out).not.toContain('"pending":[]');

      // Hết việc: deploy.sh nhận biết bằng đúng chuỗi `"pending":[]` (JSON.stringify không có khoảng trắng).
      await run(uri, migrations, 'up', '--apply');
      const done = await run(uri, migrations, 'status', '--json');
      expect(done.code).toBe(EXIT_CODE.OK);
      expect(done.out).toContain('"pending":[]');
      expect(JSON.parse(done.out)).toMatchObject({
        systemVersion: { value: APP.version },
        locked: null,
        lastError: null,
      });

      // Có khóa: mã 3 nhưng vẫn in JSON hợp lệ có `locked`.
      await db.collection('system').insertOne({
        _id: 'migration-lock',
        at: new Date(),
        by: 'deploy',
      } as never);
      const locked = await run(uri, migrations, 'status', '--json');
      expect(locked.code).toBe(EXIT_CODE.LOCKED);
      expect(JSON.parse(locked.out)).toMatchObject({
        locked: { by: 'deploy' },
      });
    });

    it('status --json khi cần baseline: mã 4 và baselineRequired=true', async () => {
      const { db, uri } = newDb();
      await db.collection('users').insertOne({ email: 'a@b.c' });
      const { code, out } = await run(
        uri,
        buildMigrations([]),
        'status',
        '--json',
      );
      expect(code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(JSON.parse(out)).toMatchObject({
        baselineRequired: true,
        systemVersion: null,
      });
    });

    it('up --apply trên Mongo KHÔNG phải replica set bị từ chối, không ghi gì', async () => {
      const standalone = await MongoMemoryServer.create();
      const standaloneClient = new MongoClient(standalone.getUri());
      try {
        await standaloneClient.connect();
        const calls: string[] = [];
        const migrations = buildMigrations(calls);
        const uri = standalone.getUri('pt027_standalone');

        const apply = await run(uri, migrations, 'up', '--apply');
        const baselineApply = await run(
          uri,
          migrations,
          'baseline',
          '--apply',
          '--version',
          '1.0.2',
        );

        expect(apply.code).toBe(EXIT_CODE.FAILURE);
        expect(apply.err).toContain('replica set');
        expect(baselineApply.code).toBe(EXIT_CODE.FAILURE);
        expect(calls).toEqual([]);
        expect(
          await standaloneClient
            .db('pt027_standalone')
            .listCollections()
            .toArray(),
        ).toHaveLength(0);
      } finally {
        await standaloneClient.close();
        await standalone.stop();
      }
    });
  });

  describe('tiêu chí 2: chạy đúng thứ tự, ghi sổ, lần 2 không làm gì', () => {
    it('chạy 007 -> 008 -> 009, ghi sổ + version, nhả khóa; chạy lần 2 không đổi gì', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const first = await run(
        uri,
        migrations,
        'up',
        '--apply',
        '--by',
        'deploy',
      );
      expect(first.code).toBe(EXIT_CODE.OK);
      expect(calls).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemIds(db)).toEqual([
        'migration:007_sample_one',
        'migration:008_sample_two',
        'migration:009_sample_three',
        'version',
      ]);
      expect(await systemDoc(db, 'migration:007_sample_one')).toMatchObject({
        by: 'deploy',
      });
      const version = await systemDoc(db, 'version');
      expect(version).toMatchObject({ value: APP.version, commit: APP.commit });
      // Tiêu chí 6 (phần runner): version trong system = phiên bản app.
      expect(await systemDoc(db, 'migration-lock')).toBeNull();

      const second = await run(uri, migrations, 'up', '--apply');
      expect(second.code).toBe(EXIT_CODE.OK);
      expect(second.out).toContain('không làm gì');
      expect(calls).toHaveLength(3);
      expect(await systemDoc(db, 'version')).toEqual(version);
    });

    it('DB rỗng (không có users) chạy được ngay không cần baseline; registry rỗng chỉ ghi version', async () => {
      const { db, uri } = newDb();
      const { code } = await run(uri, [], 'up', '--apply');
      expect(code).toBe(EXIT_CODE.OK);
      expect(await systemIds(db)).toEqual(['version']);
    });

    it('registry hỏng (hở số) làm runner từ chối chạy, không ghi gì', async () => {
      const { db, uri } = newDb();
      const broken = buildMigrations([]).filter(
        (m) => m.id !== '008_sample_two',
      );
      const { code, err } = await run(uri, broken, 'up', '--apply');
      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(err).toContain('Registry migration không hợp lệ');
      expect(await db.listCollections().toArray()).toHaveLength(0);
    });
  });

  describe('tiêu chí 3: migration lỗi dừng ngay, ghi migration-last-error sạch, thoát mã khác 0', () => {
    it('lỗi ở cái thứ 2 trong 3: cái 1 vào sổ, cái 2 không, cái 3 không chạy', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const failing = (): Promise<void> =>
        Promise.reject(
          new Error(
            `không kết nối được mongodb://admin:SuperSecret@mongo:27017/realestate ${'x'.repeat(900)}`,
          ),
        );
      const migrations = buildMigrations(calls, { '008_sample_two': failing });

      const result = await run(uri, migrations, 'up', '--apply');

      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(calls).toEqual(['007_sample_one', '008_sample_two']);
      expect(await systemDoc(db, 'migration:007_sample_one')).not.toBeNull();
      expect(await systemDoc(db, 'migration:008_sample_two')).toBeNull();
      expect(await systemDoc(db, 'migration:009_sample_three')).toBeNull();
      expect(await systemDoc(db, 'version')).toBeNull();
      expect(await systemDoc(db, 'migration-lock')).toBeNull();

      const lastError = (await systemDoc(
        db,
        'migration-last-error',
      )) as unknown as {
        migrationId: string;
        message: string;
      };
      expect(lastError.migrationId).toBe('008_sample_two');
      expect(lastError.message.length).toBeLessThanOrEqual(500);
      expect(lastError.message).not.toContain('mongodb://');
      expect(lastError.message).not.toContain('SuperSecret');
      expect(result.err).not.toContain('SuperSecret');
      expect(result.out + result.err).not.toContain('SuperSecret');
    });

    it('sau khi sửa nguyên nhân, up --apply thử lại migration lỗi + chạy tiếp, rồi xóa last-error', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const failing = (): Promise<void> =>
        Promise.reject(new Error('hỏng tạm'));
      expect(
        (
          await run(
            uri,
            buildMigrations(calls, { '008_sample_two': failing }),
            'up',
            '--apply',
          )
        ).code,
      ).toBe(EXIT_CODE.FAILURE);
      const statusAfterFail = await run(uri, buildMigrations([]), 'status');
      expect(statusAfterFail.out).toContain('Lỗi gần nhất: 008_sample_two');

      const retryCalls: string[] = [];
      const retry = await run(
        uri,
        buildMigrations(retryCalls),
        'up',
        '--apply',
      );

      expect(retry.code).toBe(EXIT_CODE.OK);
      // 007 đã vào sổ nên không chạy lại; 008 (đã sửa) và 009 chạy.
      expect(retryCalls).toEqual(['008_sample_two', '009_sample_three']);
      expect(await systemDoc(db, 'migration-last-error')).toBeNull();
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: APP.version,
      });
    });
  });

  describe('tiêu chí 4: song song chỉ một bên chạy; khóa sót thì unlock gỡ được', () => {
    it('runner thứ 2 thoát mã khác 0 khi runner thứ 1 còn đang giữ khóa', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = async (): Promise<void> => {
        await gate;
      };
      const migrations = buildMigrations(calls, { '007_sample_one': slow });

      const first = run(uri, migrations, 'up', '--apply');
      // Chờ tới khi runner 1 đã giữ khóa và đang ở trong migration 007.
      for (let i = 0; i < 100 && calls.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(calls).toEqual(['007_sample_one']);
      expect(await systemDoc(db, 'migration-lock')).not.toBeNull();

      const second = await run(uri, migrations, 'up', '--apply');
      const statusWhileLocked = await run(uri, migrations, 'status');
      release();
      const firstResult = await first;

      expect(second.code).toBe(EXIT_CODE.LOCKED);
      expect(second.err).toContain('migration-lock');
      expect(statusWhileLocked.code).toBe(EXIT_CODE.LOCKED);
      expect(firstResult.code).toBe(EXIT_CODE.OK);
      // 007 chỉ chạy đúng một lần dù có 2 runner.
      expect(calls.filter((id) => id === '007_sample_one')).toHaveLength(1);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });

    it('hai runner khởi động ĐỒNG THỜI (Promise.all): mỗi migration chạy đúng một lần, không runner nào lỗi lạ', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const [a, b] = await Promise.all([
        run(uri, migrations, 'up', '--apply', '--by', 'deploy'),
        run(uri, migrations, 'up', '--apply', '--by', 'cli'),
      ]);

      // Một bên thắng khóa (OK); bên kia hoặc thua khóa (3) hoặc vào sau, đọc lại sổ SAU khi giữ khóa và không làm gì (0).
      expect([EXIT_CODE.OK, EXIT_CODE.LOCKED]).toContain(a.code);
      expect([EXIT_CODE.OK, EXIT_CODE.LOCKED]).toContain(b.code);
      expect([a.code, b.code]).toContain(EXIT_CODE.OK);
      expect([...calls].sort()).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: APP.version,
      });
    });

    it('migration đầu tiên lỗi: nhả khóa, báo lỗi gốc, không migration nào vào sổ', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const failing = (): Promise<void> => Promise.reject(new Error('hỏng'));
      const result = await run(
        uri,
        buildMigrations(calls, { '007_sample_one': failing }),
        'up',
        '--apply',
      );
      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.err).toContain('LỖI ở 007_sample_one: hỏng');
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(calls).toEqual(['007_sample_one']);
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:')),
      ).toEqual([]);
    });

    it('race giữa đọc sổ và giành khóa (up): sổ đã đổi sau lần đọc đầu thì lần đọc lại SAU khóa ngăn chạy lại', async () => {
      const { db, uri } = newDb();
      const migrations = buildMigrations([]);
      // Runner A chạy xong toàn bộ.
      await run(uri, migrations, 'up', '--apply');

      // Runner B: lần đọc ĐẦU (trước khóa) trả ảnh chụp cũ "chưa có gì", các lần sau đọc thật (đã đủ sổ).
      const realRead = migrationState.readMigrationState;
      const spy = jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementationOnce(() =>
          Promise.resolve({
            version: { value: '0.0.1', commit: null, updatedAt: new Date() },
            applied: [],
            lock: null,
            lastError: null,
            baselineRequired: false,
            hasUsers: false,
          }),
        )
        .mockImplementation(realRead);
      const callsB: string[] = [];
      try {
        const result = await run(uri, buildMigrations(callsB), 'up', '--apply');
        expect(result.code).toBe(EXIT_CODE.OK);
      } finally {
        spy.mockRestore();
      }

      expect(callsB).toEqual([]);
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });

    it('race giữa đọc sổ và giành khóa (baseline): version đã có sau lần đọc đầu thì baseline từ chối, không ghi đè', async () => {
      const { db, uri } = newDb();
      await db.collection('users').insertOne({ email: 'a@b.c' });
      await db.collection('system').insertOne({
        _id: 'version',
        value: '1.0.5',
        commit: null,
        updatedAt: new Date(),
      } as never);

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
        const result = await run(
          uri,
          [],
          'baseline',
          '--apply',
          '--version',
          '1.0.2',
        );
        expect(result.code).toBe(EXIT_CODE.FAILURE);
        expect(result.err).toContain('chỉ chạy một lần');
      } finally {
        spy.mockRestore();
      }

      expect(await systemDoc(db, 'version')).toMatchObject({ value: '1.0.5' });
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:')),
      ).toEqual([]);
    });

    it('khóa còn sót: up --apply bị từ chối (mã 3), unlock gỡ, rồi chạy được', async () => {
      const { db, uri } = newDb();
      const calls: string[] = [];
      const migrations = buildMigrations(calls);
      await db.collection('system').insertOne({
        _id: 'migration-lock',
        at: new Date(),
        by: 'cli',
      } as never);

      expect((await run(uri, migrations, 'up', '--apply')).code).toBe(
        EXIT_CODE.LOCKED,
      );
      expect(calls).toEqual([]);

      const unlock = await run(uri, migrations, 'unlock');
      expect(unlock.code).toBe(EXIT_CODE.OK);
      expect(unlock.out).toContain('Đã gỡ khóa');
      expect((await run(uri, migrations, 'unlock')).out).toContain(
        'Không có khóa',
      );
      expect((await run(uri, migrations, 'up', '--apply')).code).toBe(
        EXIT_CODE.OK,
      );
      expect(calls).toHaveLength(3);
    });
  });

  describe('tiêu chí 5: chốt chặn baseline', () => {
    const seedUsers = (db: Db) =>
      db.collection('users').insertOne({ email: 'admin@example.com' });

    it('users có dữ liệu mà system chưa có version: up --apply từ chối, không chạy gì, báo cần baseline', async () => {
      const { db, uri } = newDb();
      await seedUsers(db);
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const apply = await run(uri, migrations, 'up', '--apply');
      const dry = await run(uri, migrations, 'up');
      const status = await run(uri, migrations, 'status');

      expect(apply.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(apply.err).toContain('baseline');
      expect(dry.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(status.code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(status.out).toContain('CẦN BASELINE');
      expect(calls).toEqual([]);
      expect(await db.collection('system').countDocuments()).toBe(0);
    });

    it('sau baseline --apply: ghi 002..006 (by baseline) + version; up chỉ chạy từ 007', async () => {
      const { db, uri } = newDb();
      await seedUsers(db);
      const calls: string[] = [];
      const migrations = buildMigrations(calls);

      const dry = await run(
        uri,
        migrations,
        'baseline',
        '--version',
        '1.0.2',
        '--commit',
        'e6099c0',
      );
      expect(dry.code).toBe(EXIT_CODE.OK);
      expect(await db.collection('system').countDocuments()).toBe(0);

      const baseline = await run(
        uri,
        migrations,
        'baseline',
        '--apply',
        '--version',
        '1.0.2',
        '--commit',
        'e6099c0',
      );
      expect(baseline.code).toBe(EXIT_CODE.OK);
      expect(await systemIds(db)).toEqual([
        'migration:002_recompute_urlhash_sha256',
        'migration:003_drop_googledrivetokens_ttl_index',
        'migration:004_users_add_team_id',
        'migration:005_users_roles_teamids',
        'migration:006_areas_34_provinces',
        'version',
      ]);
      expect(
        await systemDoc(db, 'migration:006_areas_34_provinces'),
      ).toMatchObject({ by: 'baseline' });
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: '1.0.2',
        commit: 'e6099c0',
      });
      expect(await systemDoc(db, 'migration-lock')).toBeNull();

      const up = await run(uri, migrations, 'up', '--apply');
      expect(up.code).toBe(EXIT_CODE.OK);
      expect(calls).toEqual([
        '007_sample_one',
        '008_sample_two',
        '009_sample_three',
      ]);
      expect(await systemDoc(db, 'version')).toMatchObject({
        value: APP.version,
        commit: APP.commit,
      });
    });

    it('hai baseline đồng thời (version khác nhau): chỉ MỘT bên thành công, version là của bên đó (không bị ghi đè)', async () => {
      const { db, uri } = newDb();
      await seedUsers(db);

      const [a, b] = await Promise.all([
        run(uri, [], 'baseline', '--apply', '--version', '1.0.1'),
        run(uri, [], 'baseline', '--apply', '--version', '1.0.2'),
      ]);

      expect(
        [a.code, b.code].filter((code) => code === EXIT_CODE.OK),
      ).toHaveLength(1);
      const winner = a.code === EXIT_CODE.OK ? '1.0.1' : '1.0.2';
      expect(await systemDoc(db, 'version')).toMatchObject({ value: winner });
      expect(await systemDoc(db, 'migration-lock')).toBeNull();
    });

    it('baseline bị gián đoạn (đã ghi sổ 002..004 nhưng chưa có version): chạy lại được và hoàn tất, không nhân đôi', async () => {
      const { db, uri } = newDb();
      await seedUsers(db);
      for (const id of [
        '002_recompute_urlhash_sha256',
        '003_drop_googledrivetokens_ttl_index',
        '004_users_add_team_id',
      ]) {
        await db.collection('system').insertOne({
          _id: `migration:${id}`,
          at: new Date('2026-01-01'),
          by: 'baseline',
        } as never);
      }

      // Chưa có version nên vẫn bị chặn `up --apply` (cần baseline).
      expect((await run(uri, [], 'up', '--apply')).code).toBe(
        EXIT_CODE.BASELINE_REQUIRED,
      );
      const result = await run(
        uri,
        [],
        'baseline',
        '--apply',
        '--version',
        '1.0.2',
      );

      expect(result.code).toBe(EXIT_CODE.OK);
      expect(result.out).toContain('2 migration ghi sổ');
      expect(
        (await systemIds(db)).filter((id) => id.startsWith('migration:')),
      ).toHaveLength(5);
      // Bản ghi cũ giữ nguyên (sổ chỉ thêm, không sửa).
      expect(
        await systemDoc(db, 'migration:002_recompute_urlhash_sha256'),
      ).toMatchObject({ at: new Date('2026-01-01') });
    });

    it('baseline chỉ chạy một lần và kiểm tra tham số', async () => {
      const { db, uri } = newDb();
      await seedUsers(db);
      const args = ['baseline', '--apply', '--version', '1.0.2'];

      expect((await run(uri, [], ...args)).code).toBe(EXIT_CODE.OK);
      const again = await run(uri, [], ...args);
      expect(again.code).toBe(EXIT_CODE.FAILURE);
      expect(again.err).toContain('chỉ chạy một lần');

      const other = newDb();
      expect((await run(other.uri, [], 'baseline', '--apply')).code).toBe(
        EXIT_CODE.USAGE,
      );
      expect(
        (await run(other.uri, [], 'baseline', '--version', 'abc', '--apply'))
          .code,
      ).toBe(EXIT_CODE.USAGE);
      expect(
        (
          await run(
            other.uri,
            [],
            'baseline',
            '--version',
            '1.0.2',
            '--commit',
            'zzz',
            '--apply',
          )
        ).code,
      ).toBe(EXIT_CODE.USAGE);
      expect(await other.db.collection('system').countDocuments()).toBe(0);
    });
  });

  describe('lỗi kết nối không để lộ mật khẩu', () => {
    it('chuỗi kết nối tới máy không tồn tại: mã 1, đầu ra không chứa mật khẩu', async () => {
      const result = await run(
        'mongodb://qauser:Sup3rS3cretPw@127.0.0.1:1/pt027_unreachable',
        [],
        'status',
      );
      expect(result.code).toBe(EXIT_CODE.FAILURE);
      expect(result.out + result.err).not.toContain('Sup3rS3cretPw');
      expect(result.err).toContain('LỖI');
    });
  });
});
