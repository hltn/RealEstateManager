/**
 * UNIT — `MigrationRunner` (PT-027) trên Mongo giả trong bộ nhớ (`FakeMongo`). Trọng tâm FR-21: nhánh `--phase` và việc
 * từ chối của `findPhaseOrderViolation` ở CẢ `up` lẫn `reconcile`, hai chiều (post-up khi còn pre-up nhỏ hơn chờ và
 * ngược lại), `--phase all` luôn hợp lệ, mã thoát và "không ghi gì" khi bị từ chối. Mỗi test kiểm GIÁ TRỊ: mã thoát,
 * thông điệp, sổ `system`, thứ tự migration đã chạy. Hành vi trên replica set thật ở `migration-runner.integration.spec.ts`.
 */
import { runBaselineProbes } from './baseline-probes';
import { FakeMongo } from './fake-mongo.fixture';
import type { FakeDoc } from './fake-mongo.fixture';
import { EXIT_CODE, MigrationRunner } from './migration-runner';
import type { ReconcileOptions, ReconcileReport } from './migration-runner';
import * as migrationState from './migration-state';
import type { Migration, MigrationPhase, PhaseFilter } from './migration.types';
import {
  BASELINE_MIGRATION_IDS,
  SYSTEM_COLLECTION,
  SYSTEM_LAST_ERROR_ID,
  SYSTEM_LOCK_ID,
  SYSTEM_VERSION_ID,
} from './system.constants';

// Probe baseline đọc DB thật; ở unit test chỉ cần điều khiển kết quả (probe có test riêng).
jest.mock('./baseline-probes', () => ({ runBaselineProbes: jest.fn() }));
const mockProbes = runBaselineProbes as jest.MockedFunction<
  typeof runBaselineProbes
>;

const APP_VERSION = '1.0.5';
const DB_VERSION = '1.0.4';

/** Ghi lại thứ tự `up` được gọi qua mọi migration của một test. */
interface Harness {
  fake: FakeMongo;
  runner: MigrationRunner;
  ran: string[];
  migrations: Migration[];
  out: string[];
  err: string[];
}

const registry = (
  ran: string[],
  specs: ReadonlyArray<[id: string, phase?: MigrationPhase]>,
  failing: ReadonlySet<string> = new Set(),
): Migration[] =>
  specs.map(([id, phase]) => ({
    id,
    description: `mô tả ${id}`,
    ...(phase ? { phase } : {}),
    up: jest.fn(() => {
      ran.push(id);
      return failing.has(id)
        ? Promise.reject(new Error(`hỏng ${id}`))
        : Promise.resolve();
    }),
  }));

const ledgerDoc = (id: string, by = 'deploy'): FakeDoc => ({
  _id: `migration:${id}`,
  at: new Date('2026-01-01T00:00:00Z'),
  by,
});
const versionDoc = (value: string): FakeDoc => ({
  _id: SYSTEM_VERSION_ID,
  value,
  commit: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

interface SetupOptions {
  /** [id, phase] theo thứ tự registry. */
  specs: ReadonlyArray<[id: string, phase?: MigrationPhase]>;
  /** Id đã có trong sổ. */
  applied?: string[];
  /** Version trong DB (mặc định 1.0.4); `null` = chưa có. */
  dbVersion?: string | null;
  appVersion?: string;
  replicaSet?: boolean;
  lock?: boolean;
  users?: boolean;
  failing?: ReadonlySet<string>;
}

const setup = (options: SetupOptions): Harness => {
  const fake = new FakeMongo(options.replicaSet === false ? null : 'rs0');
  const dbVersion =
    options.dbVersion === undefined ? DB_VERSION : options.dbVersion;
  const system: FakeDoc[] = (options.applied ?? []).map((id) => ledgerDoc(id));
  if (dbVersion !== null) system.push(versionDoc(dbVersion));
  if (options.lock) {
    system.push({
      _id: SYSTEM_LOCK_ID,
      at: new Date('2026-01-02T00:00:00Z'),
      by: 'cli',
    });
  }
  fake.seed(SYSTEM_COLLECTION, system);
  if (options.users) fake.seed('users', [{ _id: 'u1' }]);
  const ran: string[] = [];
  const migrations = registry(ran, options.specs, options.failing);
  const out: string[] = [];
  const err: string[] = [];
  const runner = new MigrationRunner({
    client: fake.client,
    migrations,
    app: { version: options.appVersion ?? APP_VERSION, commit: 'abc1234' },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { fake, runner, ran, migrations, out, err };
};

/** Sổ hiện có (id migration, đã sắp). */
const ledgerIds = (fake: FakeMongo): string[] =>
  fake
    .all(SYSTEM_COLLECTION)
    .map((doc) => String(doc._id))
    .filter((id) => id.startsWith('migration:') && id !== SYSTEM_LAST_ERROR_ID)
    .map((id) => id.slice('migration:'.length))
    .sort();

const systemDoc = (fake: FakeMongo, id: string): FakeDoc | undefined =>
  fake.all(SYSTEM_COLLECTION).find((doc) => doc._id === id);

const reconcileOptions = (
  patch: Partial<ReconcileOptions> = {},
): ReconcileOptions => ({
  apply: false,
  by: 'deploy',
  skipVersion: false,
  json: false,
  ...patch,
});

const parseReport = (out: string[]): ReconcileReport => {
  expect(out).toHaveLength(1);
  return JSON.parse(out[0]) as ReconcileReport;
};

// 007 pre-up, 008 post-up, 009 pre-up: pre-up 009 vượt mặt post-up 008 nhỏ hơn.
const PRE_POST_PRE: SetupOptions['specs'] = [
  ['007_alpha'],
  ['008_beta', 'post-up'],
  ['009_gamma', 'pre-up'],
];
// 007 pre-up, 008 post-up: post-up 008 vượt mặt pre-up 007 nhỏ hơn.
const PRE_POST: SetupOptions['specs'] = [
  ['007_alpha'],
  ['008_beta', 'post-up'],
];

describe('MigrationRunner', () => {
  beforeEach(() => {
    mockProbes.mockReset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('up: nhánh --phase', () => {
    it('pre-up trước, post-up sau: mỗi lần chỉ chạy đúng pha, ghi sổ từng cái, thứ tự đúng', async () => {
      const { runner, fake, ran } = setup({
        specs: [['007_alpha'], ['008_beta'], ['009_gamma', 'post-up']],
      });

      const preCode = await runner.up(true, 'deploy', 'pre-up');

      expect(preCode).toBe(EXIT_CODE.OK);
      expect(ran).toEqual(['007_alpha', '008_beta']);
      expect(ledgerIds(fake)).toEqual(['007_alpha', '008_beta']);

      const postCode = await runner.up(true, 'deploy', 'post-up');

      expect(postCode).toBe(EXIT_CODE.OK);
      expect(ran).toEqual(['007_alpha', '008_beta', '009_gamma']);
      expect(ledgerIds(fake)).toEqual(['007_alpha', '008_beta', '009_gamma']);
    });

    it('migration không khai báo phase được coi là pre-up (chạy ở --phase pre-up, không chạy ở --phase post-up)', async () => {
      const pre = setup({
        specs: [['007_alpha'], ['008_beta', 'post-up']],
        applied: [],
      });
      // Pre-up trước: 007 (không khai báo) chạy, 008 post-up thì không.
      expect(await pre.runner.up(true, 'deploy', 'pre-up')).toBe(EXIT_CODE.OK);
      expect(pre.ran).toEqual(['007_alpha']);

      // Post-up sau khi 007 đã xong: chỉ chạy 008.
      const post = setup({
        specs: [['007_alpha'], ['008_beta', 'post-up']],
        applied: ['007_alpha'],
      });
      expect(await post.runner.up(true, 'deploy', 'post-up')).toBe(
        EXIT_CODE.OK,
      );
      expect(post.ran).toEqual(['008_beta']);
    });

    it('--phase all (và mặc định khi bỏ tham số) luôn hợp lệ dù pre/post xen kẽ: chạy theo số tăng dần', async () => {
      const explicit = setup({ specs: PRE_POST_PRE });
      const implicit = setup({ specs: PRE_POST_PRE });

      expect(await explicit.runner.up(true, 'deploy', 'all')).toBe(
        EXIT_CODE.OK,
      );
      expect(await implicit.runner.up(true, 'deploy')).toBe(EXIT_CODE.OK);

      const expected = ['007_alpha', '008_beta', '009_gamma'];
      expect(explicit.ran).toEqual(expected);
      expect(implicit.ran).toEqual(expected);
      expect(ledgerIds(explicit.fake)).toEqual(expected);
      expect(explicit.err).toEqual([]);
    });

    it('dry-run theo pha: chỉ liệt kê migration của pha đó kèm nhãn pha, không ghi, không chạy', async () => {
      const { runner, fake, out, ran } = setup({
        specs: [['007_alpha'], ['008_beta'], ['009_gamma', 'post-up']],
      });
      const before = fake.snapshot();

      const code = await runner.up(false, 'cli', 'pre-up');

      expect(code).toBe(EXIT_CODE.OK);
      expect(out).toContain('Migration chờ (2):');
      expect(out).toContain('  007_alpha [pre-up] - mô tả 007_alpha');
      expect(out).toContain('  008_beta [pre-up] - mô tả 008_beta');
      expect(out.join('\n')).not.toContain('009_gamma');
      expect(ran).toEqual([]);
      expect(fake.writeCalls).toBe(0);
      expect(fake.snapshot()).toEqual(before);
    });

    it('pha không có migration chờ: báo không có và vẫn mã 0 (dry-run)', async () => {
      const { runner, out } = setup({
        specs: [['007_alpha'], ['008_beta', 'post-up']],
        applied: ['007_alpha', '008_beta'],
        dbVersion: APP_VERSION,
      });

      expect(await runner.up(false, 'cli', 'post-up')).toBe(EXIT_CODE.OK);
      expect(out).toContain('Migration chờ: không có.');
    });
  });

  describe('up: từ chối theo findPhaseOrderViolation (hai chiều)', () => {
    it.each<
      [
        label: string,
        specs: SetupOptions['specs'],
        phase: PhaseFilter,
        message: string,
      ]
    >([
      [
        'chạy pre-up khi còn post-up nhỏ hơn chờ',
        PRE_POST_PRE,
        'pre-up',
        'Từ chối: Còn migration post-up chờ 008_beta có số nhỏ hơn migration pre-up chờ 009_gamma: ' +
          'chạy `--phase post-up` trước (chạy pre-up lúc này sẽ tạo lỗ hổng sổ).',
      ],
      [
        'chạy post-up khi còn pre-up nhỏ hơn chờ',
        PRE_POST,
        'post-up',
        'Từ chối: Còn migration pre-up chờ 007_alpha có số nhỏ hơn migration post-up chờ 008_beta: ' +
          'chạy `--phase pre-up` trước (chạy post-up lúc này sẽ tạo lỗ hổng sổ).',
      ],
    ])(
      '%s: mã 1, in lý do ra stderr, KHÔNG ghi gì (cả dry-run lẫn --apply), không chạy migration',
      async (_label, specs, phase, message) => {
        for (const apply of [false, true]) {
          const { runner, fake, err, out, ran } = setup({ specs });
          const before = fake.snapshot();

          const code = await runner.up(apply, 'deploy', phase);

          expect(code).toBe(EXIT_CODE.FAILURE);
          expect(code).toBe(1);
          expect(err).toEqual([message]);
          expect(out).toEqual([]);
          expect(ran).toEqual([]);
          expect(fake.writeCalls).toBe(0);
          expect(fake.snapshot()).toEqual(before);
          expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
        }
      },
    );

    it('hết bị từ chối khi migration pha kia nhỏ hơn đã vào sổ; còn chờ thì vẫn bị từ chối', async () => {
      const post = setup({ specs: PRE_POST_PRE, applied: ['007_alpha'] });
      // Còn post-up 008 chờ nhỏ hơn pre-up 009: vẫn bị từ chối.
      expect(await post.runner.up(true, 'deploy', 'pre-up')).toBe(
        EXIT_CODE.FAILURE,
      );

      const done = setup({
        specs: PRE_POST_PRE,
        applied: ['007_alpha', '008_beta'],
      });
      expect(await done.runner.up(true, 'deploy', 'pre-up')).toBe(EXIT_CODE.OK);
      expect(done.ran).toEqual(['009_gamma']);
    });

    it('pre-up chờ cao hơn chỉ vi phạm khi post-up chờ NHỎ HƠN; post-up chờ lớn hơn thì được chạy pre-up', async () => {
      const { runner, ran } = setup({
        specs: [['007_alpha'], ['008_beta'], ['009_gamma', 'post-up']],
      });

      expect(await runner.up(true, 'deploy', 'pre-up')).toBe(EXIT_CODE.OK);
      expect(ran).toEqual(['007_alpha', '008_beta']);
    });

    it('từ chối ở lần đọc lại SAU khi giữ khóa: mã 1, không chạy migration, khóa được nhả', async () => {
      const { runner, fake, err, ran } = setup({ specs: PRE_POST });
      // Lần đọc đầu thấy 007 đã xong (hợp lệ), lần đọc sau khóa thấy 007 chưa xong (runner khác đổi sổ).
      const actual = migrationState.readMigrationState;
      jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementationOnce(async (db) => {
          const state = await actual(db);
          return {
            ...state,
            applied: [
              { id: '007_alpha', at: new Date(), by: 'deploy' as const },
            ],
          };
        });

      const code = await runner.up(true, 'deploy', 'post-up');

      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(err).toHaveLength(1);
      expect(err[0]).toContain('chạy `--phase pre-up` trước');
      expect(ran).toEqual([]);
      expect(ledgerIds(fake)).toEqual([]);
      expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });
  });

  describe('up: các nhánh còn lại', () => {
    it('apply thành công: chạy theo thứ tự, ghi sổ by=actor, ghi version + commit, xóa lỗi cũ, nhả khóa', async () => {
      const { runner, fake, out, err } = setup({
        specs: [['007_alpha'], ['008_beta']],
      });
      fake.seed(SYSTEM_COLLECTION, [
        {
          _id: SYSTEM_LAST_ERROR_ID,
          migrationId: '007_alpha',
          message: 'lỗi cũ',
          at: new Date(),
        },
      ]);

      const code = await runner.up(true, 'cli');

      expect(code).toBe(EXIT_CODE.OK);
      expect(err).toEqual([]);
      expect(out).toEqual([
        'Chạy 007_alpha: mô tả 007_alpha',
        'Xong 007_alpha.',
        'Chạy 008_beta: mô tả 008_beta',
        'Xong 008_beta.',
        `Hoàn tất. Phiên bản hệ thống: ${APP_VERSION}.`,
      ]);
      expect(systemDoc(fake, 'migration:007_alpha')?.by).toBe('cli');
      expect(systemDoc(fake, SYSTEM_VERSION_ID)).toMatchObject({
        value: APP_VERSION,
        commit: 'abc1234',
      });
      expect(systemDoc(fake, SYSTEM_LAST_ERROR_ID)).toBeUndefined();
      expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });

    it('dry-run mặc định: không ghi gì, báo version sẽ ghi và cảnh báo khi đang có khóa', async () => {
      const { runner, fake, out } = setup({
        specs: [['007_alpha']],
        lock: true,
      });
      const before = fake.snapshot();

      const code = await runner.up(false, 'cli');

      expect(code).toBe(EXIT_CODE.OK);
      expect(out[0]).toBe('[DRY-RUN] Không ghi gì vào DB.');
      expect(out).toContain('Cảnh báo: đang có khóa (cli).');
      expect(out).toContain(
        `Phiên bản sẽ ghi: ${DB_VERSION} -> ${APP_VERSION}`,
      );
      expect(fake.writeCalls).toBe(0);
      expect(fake.snapshot()).toEqual(before);
    });

    it('không có migration chờ và version đã khớp: không làm gì, không giành khóa', async () => {
      const { runner, fake, out } = setup({
        specs: [['007_alpha']],
        applied: ['007_alpha'],
        dbVersion: APP_VERSION,
      });

      const code = await runner.up(true, 'deploy');

      expect(code).toBe(EXIT_CODE.OK);
      expect(out).toEqual([
        'Không có migration chờ và version đã khớp: không làm gì.',
      ]);
      expect(fake.writeCalls).toBe(0);
    });

    it('Mongo không phải replica set: --apply bị từ chối (mã 1), không ghi', async () => {
      const { runner, fake, err, ran } = setup({
        specs: [['007_alpha']],
        replicaSet: false,
      });

      expect(await runner.up(true, 'deploy')).toBe(EXIT_CODE.FAILURE);
      expect(err[0]).toContain('MongoDB không phải replica set');
      expect(ran).toEqual([]);
      expect(fake.writeCalls).toBe(0);
    });

    it('app CŨ hơn DB (downgrade): mã 5 cho cả dry-run lẫn apply, không migrate, không hạ version', async () => {
      for (const apply of [false, true]) {
        const { runner, fake, err, ran } = setup({
          specs: [['007_alpha']],
          dbVersion: '1.0.9',
        });

        expect(await runner.up(apply, 'deploy')).toBe(EXIT_CODE.DOWNGRADE);
        expect(err[0]).toContain('CŨ hơn DB 1.0.9');
        expect(ran).toEqual([]);
        expect(fake.writeCalls).toBe(0);
        expect(systemDoc(fake, SYSTEM_VERSION_ID)?.value).toBe('1.0.9');
      }
    });

    it('version DB sai định dạng không bị coi là downgrade', async () => {
      const { runner, ran } = setup({
        specs: [['007_alpha']],
        dbVersion: 'abc',
      });

      expect(await runner.up(true, 'deploy')).toBe(EXIT_CODE.OK);
      expect(ran).toEqual(['007_alpha']);
    });

    it('cần baseline (users có dữ liệu, chưa có version, sổ thiếu 002..006): mã 4, không ghi', async () => {
      const { runner, fake, err, ran } = setup({
        specs: [['007_alpha']],
        dbVersion: null,
        users: true,
      });

      expect(await runner.up(true, 'deploy')).toBe(EXIT_CODE.BASELINE_REQUIRED);
      expect(err[0]).toContain('reconcile --apply');
      expect(ran).toEqual([]);
      expect(fake.writeCalls).toBe(0);
    });

    it('đang có khóa: --apply trả mã 3, không chạy migration và KHÔNG gỡ khóa của runner khác', async () => {
      const { runner, fake, err, ran } = setup({
        specs: [['007_alpha']],
        lock: true,
      });

      expect(await runner.up(true, 'deploy')).toBe(EXIT_CODE.LOCKED);
      expect(err[0]).toContain('đang có runner khác chạy');
      expect(ran).toEqual([]);
      expect(systemDoc(fake, SYSTEM_LOCK_ID)?.by).toBe('cli');
    });

    it('migration lỗi: dừng, ghi migration-last-error, không ghi sổ cái lỗi, không chạy cái sau, mã 1, nhả khóa, không ghi version', async () => {
      const { runner, fake, err, ran } = setup({
        specs: [['007_alpha'], ['008_beta'], ['009_gamma']],
        failing: new Set(['008_beta']),
      });

      const code = await runner.up(true, 'deploy');

      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(ran).toEqual(['007_alpha', '008_beta']);
      expect(ledgerIds(fake)).toEqual(['007_alpha']);
      expect(systemDoc(fake, SYSTEM_LAST_ERROR_ID)).toMatchObject({
        migrationId: '008_beta',
        message: 'hỏng 008_beta',
      });
      expect(err[0]).toBe('LỖI ở 008_beta: hỏng 008_beta');
      expect(systemDoc(fake, SYSTEM_VERSION_ID)?.value).toBe(DB_VERSION);
      expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });

    it('migration lỗi có chuỗi kết nối Mongo kèm mật khẩu: message lưu vào migration-last-error và in ra màn hình đã được lọc', async () => {
      const { runner, fake, err, migrations } = setup({
        specs: [['007_alpha'], ['008_beta']],
      });
      (migrations[1].up as jest.Mock).mockRejectedValueOnce(
        new Error(
          'kết nối mongodb://admin:S3cretPass@db.internal:27017/crm thất bại',
        ),
      );

      expect(await runner.up(true, 'deploy')).toBe(EXIT_CODE.FAILURE);

      const stored = String(systemDoc(fake, SYSTEM_LAST_ERROR_ID)?.message);
      expect(stored).toBe('kết nối [URI đã lọc] thất bại');
      expect(err[0]).toBe('LỖI ở 008_beta: kết nối [URI đã lọc] thất bại');
      expect(JSON.stringify(fake.all(SYSTEM_COLLECTION))).not.toContain(
        'S3cretPass',
      );
      expect(err.join(' ')).not.toContain('S3cretPass');
    });

    it('registry hỏng (hở số): ném lỗi, không ghi gì', async () => {
      const { runner, fake } = setup({
        specs: [['007_alpha'], ['009_gamma']],
      });

      await expect(runner.up(true, 'deploy')).rejects.toThrow(
        'Registry migration không hợp lệ',
      );
      expect(fake.writeCalls).toBe(0);
    });
  });

  describe('reconcile: nhánh --phase', () => {
    it('pre-up rồi post-up: mỗi lần chỉ chạy đúng pha; pha trước dùng --skip-version KHÔNG ghi version, pha sau ghi version', async () => {
      const { runner, fake, ran, out } = setup({ specs: PRE_POST });

      const pre = await runner.reconcile(
        reconcileOptions({
          apply: true,
          phase: 'pre-up',
          skipVersion: true,
          json: true,
        }),
      );

      expect(pre).toBe(EXIT_CODE.OK);
      const preReport = JSON.parse(out[0]) as ReconcileReport;
      expect(preReport).toMatchObject({
        mode: 'apply',
        result: 'ok',
        exitCode: 0,
        applied: true,
        plan: {
          baseline: [],
          migrations: ['007_alpha'],
          versionToWrite: null,
          noop: false,
        },
      });
      expect(ran).toEqual(['007_alpha']);
      expect(ledgerIds(fake)).toEqual(['007_alpha']);
      expect(systemDoc(fake, SYSTEM_VERSION_ID)?.value).toBe(DB_VERSION);

      out.length = 0;
      const post = await runner.reconcile(
        reconcileOptions({ apply: true, phase: 'post-up', json: true }),
      );

      expect(post).toBe(EXIT_CODE.OK);
      const postReport = JSON.parse(out[0]) as ReconcileReport;
      expect(postReport.plan).toMatchObject({
        migrations: ['008_beta'],
        versionToWrite: APP_VERSION,
      });
      expect(ran).toEqual(['007_alpha', '008_beta']);
      expect(ledgerIds(fake)).toEqual(['007_alpha', '008_beta']);
      expect(systemDoc(fake, SYSTEM_VERSION_ID)).toMatchObject({
        value: APP_VERSION,
        commit: 'abc1234',
      });
      expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });

    it('bỏ trống phase = all: kế hoạch gồm mọi migration chờ theo thứ tự, kể cả pre/post xen kẽ', async () => {
      const { runner, out, ran } = setup({ specs: PRE_POST_PRE });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.OK);
      expect(parseReport(out).plan?.migrations).toEqual([
        '007_alpha',
        '008_beta',
        '009_gamma',
      ]);
      expect(ran).toEqual(['007_alpha', '008_beta', '009_gamma']);
    });

    it('--phase all tường minh luôn hợp lệ (dry-run): mã 0, không ghi gì', async () => {
      const { runner, fake, out } = setup({ specs: PRE_POST_PRE });
      const before = fake.snapshot();

      const code = await runner.reconcile(
        reconcileOptions({ phase: 'all', json: true }),
      );

      expect(code).toBe(EXIT_CODE.OK);
      expect(parseReport(out)).toMatchObject({
        mode: 'dry-run',
        result: 'ok',
        applied: false,
      });
      expect(fake.writeCalls).toBe(0);
      expect(fake.snapshot()).toEqual(before);
    });
  });

  describe('reconcile: từ chối theo findPhaseOrderViolation (hai chiều)', () => {
    it.each<
      [
        label: string,
        specs: SetupOptions['specs'],
        phase: PhaseFilter,
        reason: string,
      ]
    >([
      [
        'pre-up khi còn post-up nhỏ hơn chờ',
        PRE_POST_PRE,
        'pre-up',
        'Còn migration post-up chờ 008_beta có số nhỏ hơn migration pre-up chờ 009_gamma: ' +
          'chạy `--phase post-up` trước (chạy pre-up lúc này sẽ tạo lỗ hổng sổ).',
      ],
      [
        'post-up khi còn pre-up nhỏ hơn chờ',
        PRE_POST,
        'post-up',
        'Còn migration pre-up chờ 007_alpha có số nhỏ hơn migration post-up chờ 008_beta: ' +
          'chạy `--phase pre-up` trước (chạy post-up lúc này sẽ tạo lỗ hổng sổ).',
      ],
    ])(
      '%s: result=refused, mã 1, JSON đúng một dòng, KHÔNG ghi gì, không chạy migration (cả dry-run lẫn --apply)',
      async (_label, specs, phase, reason) => {
        for (const apply of [false, true]) {
          const { runner, fake, out, err, ran } = setup({ specs });
          const before = fake.snapshot();

          const code = await runner.reconcile(
            reconcileOptions({ apply, phase, json: true }),
          );

          expect(code).toBe(EXIT_CODE.FAILURE);
          expect(parseReport(out)).toEqual({
            mode: apply ? 'apply' : 'dry-run',
            result: 'refused',
            exitCode: 1,
            appVersion: APP_VERSION,
            systemVersion: DB_VERSION,
            plan: null,
            probes: [],
            warnings: [],
            reason,
            applied: false,
          });
          expect(err).toEqual([`Từ chối: ${reason}`]);
          expect(ran).toEqual([]);
          expect(fake.writeCalls).toBe(0);
          expect(fake.snapshot()).toEqual(before);
        }
      },
    );

    it('không --json: không in JSON, lý do ra stderr, vẫn mã 1', async () => {
      const { runner, out, err } = setup({ specs: PRE_POST });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, phase: 'post-up' }),
      );

      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(out).toEqual([]);
      expect(err).toHaveLength(1);
      expect(err[0]).toMatch(/^Từ chối: Còn migration pre-up chờ 007_alpha/);
    });

    it('bị từ chối ở lần lập kế hoạch SAU khi giữ khóa: mã 1, không chạy gì, khóa được nhả, report không còn kế hoạch cũ', async () => {
      const { runner, fake, out, ran } = setup({ specs: PRE_POST });
      const actual = migrationState.readMigrationState;
      jest
        .spyOn(migrationState, 'readMigrationState')
        .mockImplementationOnce(async (db) => {
          const state = await actual(db);
          return {
            ...state,
            applied: [
              { id: '007_alpha', at: new Date(), by: 'deploy' as const },
            ],
          };
        });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, phase: 'post-up', json: true }),
      );

      expect(code).toBe(EXIT_CODE.FAILURE);
      const report = parseReport(out);
      expect(report).toMatchObject({
        result: 'refused',
        exitCode: 1,
        applied: false,
      });
      expect(report.plan).toBeNull();
      expect(report.reason).toContain('chạy `--phase pre-up` trước');
      expect(ran).toEqual([]);
      expect(ledgerIds(fake)).toEqual([]);
      expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });
  });

  describe('reconcile: các nhánh còn lại', () => {
    it('dry-run: kế hoạch + mã 0, không ghi', async () => {
      const { runner, fake, out } = setup({ specs: PRE_POST });
      const before = fake.snapshot();

      const code = await runner.reconcile(reconcileOptions());

      expect(code).toBe(EXIT_CODE.OK);
      expect(out).toContain('Baseline: không cần.');
      expect(out).toContain('Migration chờ (2): 007_alpha, 008_beta');
      expect(out).toContain(
        `Phiên bản sẽ ghi: ${DB_VERSION} -> ${APP_VERSION}`,
      );
      expect(out).toContain(
        '[DRY-RUN] Không ghi gì vào DB. Chạy thật: thêm --apply (sau khi đã backup).',
      );
      expect(fake.snapshot()).toEqual(before);
    });

    it('--json: log tiến trình ra stderr, stdout đúng một dòng JSON', async () => {
      const { runner, out, err } = setup({ specs: PRE_POST });

      await runner.reconcile(reconcileOptions({ json: true }));

      expect(out).toHaveLength(1);
      expect(() => JSON.parse(out[0])).not.toThrow();
      expect(err).toContain('Migration chờ (2): 007_alpha, 008_beta');
    });

    it('không phải replica set: dry-run cũng trả mã 1 (cùng mã với --apply), result=refused', async () => {
      for (const apply of [false, true]) {
        const { runner, fake, out } = setup({
          specs: PRE_POST,
          replicaSet: false,
        });

        const code = await runner.reconcile(
          reconcileOptions({ apply, json: true }),
        );

        expect(code).toBe(EXIT_CODE.FAILURE);
        expect(parseReport(out)).toMatchObject({
          result: 'refused',
          reason: 'MongoDB không phải replica set.',
        });
        expect(fake.writeCalls).toBe(0);
      }
    });

    it('app cũ hơn DB: result=downgrade, mã 5, không ghi', async () => {
      const { runner, fake, out } = setup({
        specs: PRE_POST,
        dbVersion: '1.0.9',
      });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.DOWNGRADE);
      expect(parseReport(out)).toMatchObject({
        result: 'downgrade',
        exitCode: 5,
        systemVersion: '1.0.9',
      });
      expect(fake.writeCalls).toBe(0);
    });

    it('đang có khóa: result=locked, mã 3, khóa của runner khác còn nguyên', async () => {
      const { runner, fake, out } = setup({ specs: PRE_POST, lock: true });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.LOCKED);
      expect(parseReport(out).result).toBe('locked');
      expect(systemDoc(fake, SYSTEM_LOCK_ID)?.by).toBe('cli');
      expect(fake.writeCalls).toBe(0);
    });

    it('không còn việc: noop, mã 0, không giành khóa', async () => {
      const { runner, fake, out } = setup({
        specs: PRE_POST,
        applied: ['007_alpha', '008_beta'],
        dbVersion: APP_VERSION,
      });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.OK);
      expect(parseReport(out)).toMatchObject({
        result: 'ok',
        applied: false,
        plan: { noop: true },
      });
      expect(fake.writeCalls).toBe(0);
    });

    it('migration lỗi giữa chừng: result=failed, mã 1, applied=true nếu đã chạy, không ghi version', async () => {
      const { runner, fake, out, ran } = setup({
        specs: PRE_POST,
        failing: new Set(['008_beta']),
      });

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.FAILURE);
      expect(ran).toEqual(['007_alpha', '008_beta']);
      expect(parseReport(out)).toMatchObject({
        result: 'failed',
        applied: true,
        reason: 'Migration lỗi (xem migration-last-error).',
      });
      expect(ledgerIds(fake)).toEqual(['007_alpha']);
      expect(systemDoc(fake, SYSTEM_VERSION_ID)?.value).toBe(DB_VERSION);
      expect(systemDoc(fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });

    it('lỗi bất ngờ (registry hỏng): result=error, mã 1, thông điệp đã lọc, vẫn in JSON', async () => {
      const { runner, out, err } = setup({
        specs: [['007_alpha'], ['009_gamma']],
      });

      const code = await runner.reconcile(reconcileOptions({ json: true }));

      expect(code).toBe(EXIT_CODE.FAILURE);
      const report = parseReport(out);
      expect(report.result).toBe('error');
      expect(report.reason).toContain('Registry migration không hợp lệ');
      expect(err[0]).toContain('LỖI: Registry migration không hợp lệ');
    });

    it('cần baseline và probe đạt: ghi sổ 002..006 (by=baseline, kèm evidence), rồi chạy migration và version', async () => {
      const { runner, fake, out } = setup({
        specs: [['007_alpha']],
        dbVersion: null,
        users: true,
      });
      mockProbes.mockResolvedValue(
        BASELINE_MIGRATION_IDS.map((id) => ({
          id,
          passed: true,
          counts: { remaining: 0 },
          warnings: [],
        })),
      );

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.OK);
      expect(parseReport(out).plan?.baseline).toEqual([
        ...BASELINE_MIGRATION_IDS,
      ]);
      for (const id of BASELINE_MIGRATION_IDS) {
        expect(systemDoc(fake, `migration:${id}`)).toMatchObject({
          by: 'baseline',
          evidence: { remaining: 0 },
        });
      }
      expect(ledgerIds(fake)).toEqual([...BASELINE_MIGRATION_IDS, '007_alpha']);
      expect(systemDoc(fake, SYSTEM_VERSION_ID)?.value).toBe(APP_VERSION);
    });

    it('cần baseline nhưng probe KHÔNG đạt: result=probe_failed, mã 4, không ghi gì', async () => {
      const { runner, fake, out, err } = setup({
        specs: [['007_alpha']],
        dbVersion: null,
        users: true,
      });
      mockProbes.mockResolvedValue(
        BASELINE_MIGRATION_IDS.map((id, index) => ({
          id,
          passed: index !== 1,
          counts: { remaining: index === 1 ? 3 : 0 },
          warnings: [],
          ...(index === 1 ? { reason: 'còn dữ liệu cũ' } : {}),
        })),
      );

      const code = await runner.reconcile(
        reconcileOptions({ apply: true, json: true }),
      );

      expect(code).toBe(EXIT_CODE.BASELINE_REQUIRED);
      const report = parseReport(out);
      expect(report.result).toBe('probe_failed');
      expect(report.probes.find((probe) => !probe.passed)).toMatchObject({
        id: BASELINE_MIGRATION_IDS[1],
        reason: 'còn dữ liệu cũ',
      });
      expect(err.some((line) => line.includes('KHÔNG ĐẠT'))).toBe(true);
      expect(fake.writeCalls).toBe(0);
    });
  });

  describe('status, unlock, baseline', () => {
    it('status --json: liệt kê migration chờ kèm pha, mã 0', async () => {
      const { runner, out } = setup({ specs: PRE_POST, applied: [] });

      const code = await runner.status(true);

      expect(code).toBe(EXIT_CODE.OK);
      const status = JSON.parse(out[0]) as {
        pending: Array<{ id: string; phase: string }>;
        replicaSet: boolean;
        systemVersion: { value: string };
      };
      expect(status.pending).toEqual([
        { id: '007_alpha', description: 'mô tả 007_alpha', phase: 'pre-up' },
        { id: '008_beta', description: 'mô tả 008_beta', phase: 'post-up' },
      ]);
      expect(status.replicaSet).toBe(true);
      expect(status.systemVersion.value).toBe(DB_VERSION);
    });

    it('status dạng chữ: đủ thông tin, đang có khóa => mã 3; cần baseline => mã 4', async () => {
      const locked = setup({ specs: PRE_POST, lock: true });
      expect(await locked.runner.status(false)).toBe(EXIT_CODE.LOCKED);
      const text = locked.out.join('\n');
      expect(text).toContain(`Phiên bản app: ${APP_VERSION} (abc1234)`);
      expect(text).toContain('Chờ post-up: 1');
      expect(text).toContain('KHÓA: đang có (cli,');

      const needBaseline = setup({
        specs: PRE_POST,
        dbVersion: null,
        users: true,
      });
      expect(await needBaseline.runner.status(false)).toBe(
        EXIT_CODE.BASELINE_REQUIRED,
      );
      expect(needBaseline.out.join('\n')).toContain('CẦN BASELINE');
    });

    it('unlock: gỡ khóa nếu có, báo không có nếu không, luôn mã 0', async () => {
      const withLock = setup({ specs: PRE_POST, lock: true });
      expect(await withLock.runner.unlock()).toBe(EXIT_CODE.OK);
      expect(withLock.out).toEqual(['Đã gỡ khóa.']);
      expect(systemDoc(withLock.fake, SYSTEM_LOCK_ID)).toBeUndefined();

      const noLock = setup({ specs: PRE_POST });
      expect(await noLock.runner.unlock()).toBe(EXIT_CODE.OK);
      expect(noLock.out).toEqual(['Không có khóa để gỡ.']);
    });

    it.each<[version: string | undefined, commit: string | undefined]>([
      [undefined, undefined],
      ['1.0', undefined],
      ['1.0.5', 'xyz'],
      ['1.0.5', 'abc12'],
    ])(
      'baseline sai tham số (version=%p, commit=%p): mã 2, không ghi',
      async (version, commit) => {
        const { runner, fake } = setup({ specs: PRE_POST, dbVersion: null });

        expect(await runner.baseline(true, version, commit)).toBe(
          EXIT_CODE.USAGE,
        );
        expect(fake.writeCalls).toBe(0);
      },
    );

    it('baseline khi system đã có version: từ chối (mã 1)', async () => {
      const { runner, fake, err } = setup({ specs: PRE_POST });

      expect(await runner.baseline(true, '1.0.5', 'abc1234')).toBe(
        EXIT_CODE.FAILURE,
      );
      expect(err[0]).toContain(`đã có version ${DB_VERSION}`);
      expect(fake.writeCalls).toBe(0);
    });

    it('baseline dry-run: liệt kê, không ghi; apply: ghi sổ 002..006 by=baseline + version + commit', async () => {
      const dry = setup({ specs: PRE_POST, dbVersion: null });
      expect(await dry.runner.baseline(false, '1.0.5', 'abc1234')).toBe(
        EXIT_CODE.OK,
      );
      expect(dry.out.join('\n')).toContain(
        'Và version = 1.0.5 (commit abc1234).',
      );
      expect(dry.fake.writeCalls).toBe(0);

      const real = setup({ specs: PRE_POST, dbVersion: null });
      expect(await real.runner.baseline(true, '1.0.5', 'abc1234')).toBe(
        EXIT_CODE.OK,
      );
      expect(ledgerIds(real.fake)).toEqual([...BASELINE_MIGRATION_IDS]);
      expect(
        systemDoc(real.fake, 'migration:002_recompute_urlhash_sha256')?.by,
      ).toBe('baseline');
      expect(systemDoc(real.fake, SYSTEM_VERSION_ID)).toMatchObject({
        value: '1.0.5',
        commit: 'abc1234',
      });
      expect(systemDoc(real.fake, SYSTEM_LOCK_ID)).toBeUndefined();
    });

    it('baseline apply trên Mongo không phải replica set: từ chối (mã 1)', async () => {
      const { runner, fake } = setup({
        specs: PRE_POST,
        dbVersion: null,
        replicaSet: false,
      });

      expect(await runner.baseline(true, '1.0.5', undefined)).toBe(
        EXIT_CODE.FAILURE,
      );
      expect(fake.writeCalls).toBe(0);
    });
  });
});
