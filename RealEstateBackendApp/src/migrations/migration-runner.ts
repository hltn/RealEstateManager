import { MongoClient, MongoServerError } from 'mongodb';
import type { Db } from 'mongodb';
import { runBaselineProbes } from './baseline-probes';
import type { ProbeResult } from './baseline-probes';
import { sanitizeErrorMessage } from './migration-error.util';
import {
  assertValidRegistry,
  readMigrationState,
  selectPendingMigrations,
} from './migration-state';
import type { MigrationState } from './migration-state';
import { findPhaseOrderViolation, getMigrationPhase } from './migration-phase';
import type { Migration, MigrationActor, PhaseFilter } from './migration.types';
import { planReconcile } from './reconcile-plan';
import type { ReconcilePlan } from './reconcile-plan';
import { compareVersions, isValidVersion } from './version-compare.util';
import {
  BASELINE_MIGRATION_IDS,
  MIGRATION_DOC_PREFIX,
  SYSTEM_COLLECTION,
  SYSTEM_LAST_ERROR_ID,
  SYSTEM_LOCK_ID,
  SYSTEM_VERSION_ID,
} from './system.constants';

/** Mã thoát của CLI: khác 0 khi lỗi/khóa để `deploy.sh` (set -e) dừng đúng chỗ. */
export const EXIT_CODE = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  LOCKED: 3,
  BASELINE_REQUIRED: 4,
  /** App CŨ hơn DB (downgrade): `reconcile` không ghi gì. */
  DOWNGRADE: 5,
} as const;
export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export interface RunnerOptions {
  client: MongoClient;
  /** Registry migration (thật = `MIGRATIONS`; test truyền registry mẫu). */
  migrations: readonly Migration[];
  app: { version: string; commit: string | null };
  /** Kênh ghi stdout / stderr (CLI nối vào process, test gom vào mảng). */
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Tùy chọn lệnh `reconcile` (dry-run mặc định khi `apply` = false). */
export interface ReconcileOptions {
  apply: boolean;
  by: MigrationActor;
  /** Không ghi `version` (deploy.sh pha trước `up` dùng cờ này; pha sau mới ghi version). */
  skipVersion: boolean;
  /** In ĐÚNG MỘT dòng JSON ra stdout; mọi log khác ra stderr. */
  json: boolean;
  /** Pha migration được chạy (`--phase`); bỏ trống = `all` (mọi migration chờ, như trước đây). */
  phase?: PhaseFilter;
}

export type ReconcileResultName =
  | 'ok'
  | 'locked'
  | 'probe_failed'
  | 'downgrade'
  | 'refused'
  | 'failed'
  | 'error';

/** Dòng JSON duy nhất `reconcile --json` in ra stdout (hợp đồng với deploy.sh). */
export interface ReconcileReport {
  mode: 'dry-run' | 'apply';
  result: ReconcileResultName;
  exitCode: ExitCode;
  appVersion: string;
  systemVersion: string | null;
  /** Kế hoạch (null nếu bị từ chối trước khi lập được kế hoạch, ví dụ khóa/downgrade/probe fail). */
  plan: {
    baseline: string[];
    migrations: string[];
    versionToWrite: string | null;
    noop: boolean;
  } | null;
  probes: Array<
    Pick<ProbeResult, 'id' | 'passed' | 'counts'> & { reason: string | null }
  >;
  warnings: string[];
  reason: string | null;
  /** `true` nếu đã ghi bất cứ thứ gì vào `system` (sổ/version). */
  applied: boolean;
}

const RESULT_BY_OUTCOME = {
  LOCKED: { result: 'locked', code: EXIT_CODE.LOCKED },
  PROBE_FAILED: { result: 'probe_failed', code: EXIT_CODE.BASELINE_REQUIRED },
  DOWNGRADE: { result: 'downgrade', code: EXIT_CODE.DOWNGRADE },
  REFUSED: { result: 'refused', code: EXIT_CODE.FAILURE },
} as const;

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const DUPLICATE_KEY_ERROR_CODE = 11000;

type SystemDoc = { _id: string } & Record<string, unknown>;

const isDuplicateKeyError = (error: unknown): boolean =>
  error instanceof MongoServerError && error.code === DUPLICATE_KEY_ERROR_CODE;

const formatDate = (date: Date): string => new Date(date).toISOString();

/**
 * Runner migration: đọc/ghi collection `system`, KHÔNG phụ thuộc NestJS. Quy tắc cốt lõi:
 * - Dry-run mặc định: không ghi gì (kể cả không tạo collection/index, không khóa).
 * - `--apply`: bắt buộc Mongo là replica set; giành khóa bằng insert `_id` duy nhất; lỗi thì dừng, không retry,
 *   không rollback, không ghi sổ cho migration lỗi.
 */
export class MigrationRunner {
  private readonly db: Db;

  constructor(private readonly options: RunnerOptions) {
    this.db = options.client.db();
  }

  private get system() {
    return this.db.collection<SystemDoc>(SYSTEM_COLLECTION);
  }

  /** `status` (chỉ đọc). Mã thoát: 3 nếu đang có khóa, 4 nếu cần baseline, còn lại 0. */
  async status(asJson: boolean): Promise<ExitCode> {
    assertValidRegistry(this.options.migrations);
    const state = await readMigrationState(this.db);
    const pending = selectPendingMigrations(
      this.options.migrations,
      state.applied,
    );
    const replicaSet = await this.isReplicaSet();

    if (asJson) {
      this.options.out(
        JSON.stringify({
          appVersion: this.options.app.version,
          appCommit: this.options.app.commit,
          systemVersion: state.version,
          applied: state.applied,
          pending: pending.map((migration) => ({
            id: migration.id,
            description: migration.description,
            phase: getMigrationPhase(migration),
          })),
          locked: state.lock,
          lastError: state.lastError,
          baselineRequired: state.baselineRequired,
          replicaSet,
        }),
      );
    } else {
      this.printStatus(state, pending, replicaSet);
    }
    if (state.lock) return EXIT_CODE.LOCKED;
    if (state.baselineRequired) return EXIT_CODE.BASELINE_REQUIRED;
    return EXIT_CODE.OK;
  }

  /** `up`: dry-run mặc định (liệt kê migration chờ), `apply` mới chạy thật. */
  async up(
    apply: boolean,
    by: MigrationActor,
    phase: PhaseFilter = 'all',
  ): Promise<ExitCode> {
    assertValidRegistry(this.options.migrations);
    const { out, err } = this.options;
    const state = await readMigrationState(this.db);

    // Chốt chặn: tuyệt đối không tự chạy 002..006 / bỏ qua sổ chỉ vì `system` trống trên DB đã có dữ liệu.
    if (state.baselineRequired) {
      err(
        'Từ chối: `system` chưa có `version` nhưng `users` đã có dữ liệu và sổ thiếu 002..006. Chạy ' +
          '`reconcile --apply` (tự probe rồi baseline) hoặc `baseline` tay một lần trước ' +
          '(node dist/migrations/cli.js baseline --apply --version <x.y.z> --commit <sha>).',
      );
      return EXIT_CODE.BASELINE_REQUIRED;
    }

    // Downgrade (app CŨ hơn DB): không migrate, không hạ version; áp dụng cả dry-run để báo trước.
    if (this.isDowngrade(state)) return this.refuseDowngrade(state);

    const phaseRefusal = this.phaseRefusal(state, phase);
    if (phaseRefusal) return phaseRefusal;

    const pending = selectPendingMigrations(
      this.options.migrations,
      state.applied,
      phase,
    );
    const versionChange = this.describeVersionChange(state);

    if (!apply) {
      out('[DRY-RUN] Không ghi gì vào DB.');
      if (state.lock) out(`Cảnh báo: đang có khóa (${state.lock.by}).`);
      this.printPending(pending);
      if (versionChange) out(`Phiên bản sẽ ghi: ${versionChange}`);
      out('Chạy thật: thêm --apply (sau khi đã backup).');
      return EXIT_CODE.OK;
    }

    if (!(await this.isReplicaSet())) {
      err(
        'Từ chối --apply: MongoDB không phải replica set (migration cần transaction).',
      );
      return EXIT_CODE.FAILURE;
    }
    if (pending.length === 0 && !versionChange) {
      out('Không có migration chờ và version đã khớp: không làm gì.');
      return EXIT_CODE.OK;
    }

    return this.withLock(by, async () => {
      // Đọc lại SAU khi giữ khóa: runner khác có thể vừa chạy xong giữa lúc đọc và lúc giành khóa.
      const fresh = await readMigrationState(this.db);
      if (this.isDowngrade(fresh)) return this.refuseDowngrade(fresh);
      const freshPhaseRefusal = this.phaseRefusal(fresh, phase);
      if (freshPhaseRefusal) return freshPhaseRefusal;
      const toRun = selectPendingMigrations(
        this.options.migrations,
        fresh.applied,
        phase,
      );
      const failure = await this.runMigrations(toRun, by, out);
      if (failure !== null) return failure;
      await this.writeVersion(
        this.options.app.version,
        this.options.app.commit,
      );
      await this.system.deleteOne({ _id: SYSTEM_LAST_ERROR_ID });
      out(`Hoàn tất. Phiên bản hệ thống: ${this.options.app.version}.`);
      return EXIT_CODE.OK;
    });
  }

  /**
   * Quy tắc an toàn sổ theo pha (FR-21): chạy `pre-up` mà còn `post-up` chờ số nhỏ hơn thì từ chối (mã 1). Trả `null`
   * nếu hợp lệ. Áp dụng cả dry-run để báo trước đúng mã thoát của `--apply`.
   */
  private phaseRefusal(
    state: MigrationState,
    phase: PhaseFilter,
  ): ExitCode | null {
    const allPending = selectPendingMigrations(
      this.options.migrations,
      state.applied,
    ).map((migration) => ({
      id: migration.id,
      phase: getMigrationPhase(migration),
    }));
    const violation = findPhaseOrderViolation(allPending, phase);
    if (violation === null) return null;
    this.options.err(`Từ chối: ${violation}`);
    return EXIT_CODE.FAILURE;
  }

  /** App cũ hơn DB (cả hai đều là semver hợp lệ). Version DB sai định dạng không coi là downgrade (như trước đây). */
  private isDowngrade(state: MigrationState): boolean {
    const dbVersion = state.version?.value;
    const appVersion = this.options.app.version;
    return (
      dbVersion !== undefined &&
      isValidVersion(dbVersion) &&
      isValidVersion(appVersion) &&
      compareVersions(appVersion, dbVersion) === -1
    );
  }

  private refuseDowngrade(state: MigrationState): ExitCode {
    this.options.err(
      `Từ chối: phiên bản app ${this.options.app.version} CŨ hơn DB ${state.version?.value} (downgrade). Không migrate, không hạ version trong DB.`,
    );
    return EXIT_CODE.DOWNGRADE;
  }

  /**
   * Chạy tuần tự các migration trong registry (đã giữ khóa): lỗi thì ghi `migration-last-error`, DỪNG, không ghi sổ cho
   * migration lỗi. Trả `null` nếu tất cả xong; trả `FAILURE` nếu có lỗi. `log` là kênh tiến trình (stdout, hoặc stderr
   * khi `--json`).
   */
  private async runMigrations(
    toRun: readonly Migration[],
    by: MigrationActor,
    log: (line: string) => void,
  ): Promise<ExitCode | null> {
    const { err } = this.options;
    for (const migration of toRun) {
      log(`Chạy ${migration.id}: ${migration.description}`);
      try {
        await migration.up({
          client: this.options.client,
          db: this.db,
          log: (message) => log(`  ${message}`),
        });
      } catch (error) {
        err(`LỖI ở ${migration.id}: ${sanitizeErrorMessage(error)}`);
        // Ghi lỗi vào `system` là "cố gắng hết sức": nếu chính việc ghi cũng lỗi (DB chập chờn) thì không được che
        // lỗi gốc và vẫn phải trả mã FAILURE (khóa vẫn được nhả ở `withLock`).
        await this.recordError(migration.id, error).catch((writeError) =>
          err(
            `Không ghi được migration-last-error: ${sanitizeErrorMessage(writeError)}`,
          ),
        );
        err(
          'Dừng, không chạy migration sau, không ghi sổ cho migration lỗi. Sửa nguyên nhân rồi chạy lại `up --apply`.',
        );
        return EXIT_CODE.FAILURE;
      }
      await this.recordApplied(migration.id, by);
      log(`Xong ${migration.id}.`);
    }
    return null;
  }

  /**
   * `reconcile`: tự đối chiếu DB với phiên bản app (PT-027). Dry-run mặc định. Luồng: đọc trạng thái -> `planReconcile`
   * (hàm thuần; nếu cần baseline thì chạy probe CHỈ ĐỌC cho id 002..006 còn thiếu) -> với `--apply`: giành khóa, ĐỌC LẠI
   * trạng thái + probe SAU khóa, rồi ghi sổ baseline (kèm evidence), chạy migration chờ và ghi version. Không bao giờ
   * chạy lại 002..006. Mã thoát: 0 ok | 1 lỗi/từ chối | 3 có khóa | 4 probe không đạt | 5 downgrade.
   * `--json`: đúng MỘT dòng JSON (`ReconcileReport`) ra stdout, log khác ra stderr. Lỗi trước khi vào runner (kết nối)
   * do `cli-app` xử lý và KHÔNG in JSON.
   */
  async reconcile(options: ReconcileOptions): Promise<ExitCode> {
    const report: ReconcileReport = {
      mode: options.apply ? 'apply' : 'dry-run',
      result: 'ok',
      exitCode: EXIT_CODE.OK,
      appVersion: this.options.app.version,
      systemVersion: null,
      plan: null,
      probes: [],
      warnings: [],
      reason: null,
      applied: false,
    };
    let code: ExitCode;
    try {
      code = await this.runReconcile(options, report);
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      this.options.err(`LỖI: ${message}`);
      report.result = 'error';
      report.reason = message;
      code = EXIT_CODE.FAILURE;
    }
    report.exitCode = code;
    if (options.json) this.options.out(JSON.stringify(report));
    return code;
  }

  private async runReconcile(
    options: ReconcileOptions,
    report: ReconcileReport,
  ): Promise<ExitCode> {
    assertValidRegistry(this.options.migrations);
    const { err } = this.options;
    const log = options.json ? err : this.options.out;

    const state = await readMigrationState(this.db);
    report.systemVersion = state.version?.value ?? null;
    const phase = options.phase ?? 'all';
    const plan = await this.resolveReconcilePlan(state, report, phase);
    const refused = this.reconcileRefusal(plan, report);
    if (refused !== null) return refused;

    this.fillPlanReport(plan, options, report);
    this.logReconcilePlan(plan, options, report, log);
    // Dry-run PHẢI trả cùng mã thoát như `--apply` sẽ trả (deploy.sh dùng dry-run để biết trước), kể cả việc
    // `--apply` bị từ chối vì Mongo không phải replica set.
    if (!(await this.isReplicaSet())) {
      err(
        options.apply
          ? 'Từ chối --apply: MongoDB không phải replica set (migration cần transaction).'
          : 'Từ chối: MongoDB không phải replica set nên --apply sẽ bị từ chối (migration cần transaction).',
      );
      report.result = 'refused';
      report.reason = 'MongoDB không phải replica set.';
      return EXIT_CODE.FAILURE;
    }
    if (!options.apply) {
      log(
        '[DRY-RUN] Không ghi gì vào DB. Chạy thật: thêm --apply (sau khi đã backup).',
      );
      return EXIT_CODE.OK;
    }
    if (this.isReconcileNoop(plan, options)) {
      log('Không có gì để làm (sổ đủ, version đã khớp hoặc bỏ qua version).');
      return EXIT_CODE.OK;
    }

    return this.withLock(options.by, async () => {
      // Đọc lại SAU khi giữ khóa (và probe lại nếu cần baseline): runner khác có thể vừa chạy giữa lúc đọc và lúc giành
      // khóa. Khóa trong ảnh chụp này là khóa CỦA TA nên bỏ qua.
      const fresh = await readMigrationState(this.db);
      report.systemVersion = fresh.version?.value ?? null;
      const locked = await this.resolveReconcilePlan(
        { ...fresh, lock: null },
        report,
        phase,
      );
      const lockedRefusal = this.reconcileRefusal(locked, report);
      if (lockedRefusal !== null) return lockedRefusal;
      this.fillPlanReport(locked, options, report);
      return this.executeReconcile(locked, options, report, log);
    });
  }

  /** Lập kế hoạch; nếu cần probe thì chạy probe chỉ-đọc rồi lập lại với kết quả. */
  private async resolveReconcilePlan(
    state: MigrationState,
    report: ReconcileReport,
    phase: PhaseFilter,
  ): Promise<ReconcilePlan> {
    const registryIds = this.options.migrations.map(({ id }) => id);
    const postUpIds = this.options.migrations
      .filter((migration) => getMigrationPhase(migration) === 'post-up')
      .map(({ id }) => id);
    const input = {
      state,
      appVersion: this.options.app.version,
      registryIds,
      postUpIds,
      phase,
    };
    let plan = planReconcile(input);
    // Mỗi lần lập kế hoạch (trước khóa, rồi lại sau khóa) bắt đầu từ báo cáo sạch: nếu lần sau bị từ chối thì report
    // không được còn kế hoạch/cảnh báo/probe của lần trước.
    report.plan = null;
    report.probes = [];
    report.warnings = [];
    if (plan.outcome === 'NEEDS_PROBES') {
      const results = await runBaselineProbes(this.db, plan.probeIds);
      report.probes = results.map(({ id, passed, counts, reason }) => ({
        id,
        passed,
        counts,
        reason: reason ?? null,
      }));
      for (const result of results) report.warnings.push(...result.warnings);
      plan = planReconcile({ ...input, probeResults: results });
    }
    return plan;
  }

  /** Kết luận KHÁC READY: ghi vào report, in lý do, trả mã thoát; READY thì trả `null` để đi tiếp. */
  private reconcileRefusal(
    plan: ReconcilePlan,
    report: ReconcileReport,
  ): ExitCode | null {
    if (plan.outcome === 'READY') return null;
    // NEEDS_PROBES không bao giờ ra khỏi `resolveReconcilePlan` (đã chạy probe); nếu có thì là lỗi lập trình.
    if (plan.outcome === 'NEEDS_PROBES') {
      throw new Error('Kế hoạch reconcile còn thiếu kết quả probe.');
    }
    const { result, code } = RESULT_BY_OUTCOME[plan.outcome];
    report.result = result;
    report.reason = plan.reason;
    const { err } = this.options;
    err(`Từ chối: ${plan.reason}`);
    if (plan.outcome === 'PROBE_FAILED') {
      for (const probe of report.probes) {
        err(
          `  ${probe.id}: ${probe.passed ? 'đạt' : 'KHÔNG ĐẠT'} ${JSON.stringify(probe.counts)}${probe.reason ? ` - ${probe.reason}` : ''}`,
        );
      }
      err(
        'Xử lý tay: chạy script migration cũ tương ứng trong scripts/migrations/ (dry-run trước), hoặc nếu đã tự kiểm chứng thì `baseline --apply --version <x.y.z>`.',
      );
    }
    return code;
  }

  /**
   * Version sẽ thực sự ghi: `--skip-version` bỏ qua, TRỪ DB mới tinh (`forceVersionWrite`: version null + users rỗng).
   */
  private effectiveVersion(
    plan: ReconcilePlan,
    options: ReconcileOptions,
  ): string | null {
    if (options.skipVersion && !plan.forceVersionWrite) return null;
    return plan.versionToWrite;
  }

  /** Không còn việc nào thực sự phải ghi (tính cả `--skip-version`). */
  private isReconcileNoop(
    plan: ReconcilePlan,
    options: ReconcileOptions,
  ): boolean {
    return (
      plan.baselineIds.length === 0 &&
      plan.pendingIds.length === 0 &&
      this.effectiveVersion(plan, options) === null
    );
  }

  private fillPlanReport(
    plan: ReconcilePlan,
    options: ReconcileOptions,
    report: ReconcileReport,
  ): void {
    report.plan = {
      baseline: plan.baselineIds,
      migrations: plan.pendingIds,
      versionToWrite: this.effectiveVersion(plan, options),
      noop: this.isReconcileNoop(plan, options),
    };
    report.warnings.push(...plan.warnings);
  }

  private logReconcilePlan(
    plan: ReconcilePlan,
    options: ReconcileOptions,
    report: ReconcileReport,
    log: (line: string) => void,
  ): void {
    for (const warning of report.warnings) log(`Cảnh báo: ${warning}`);
    for (const probe of report.probes) {
      log(`Probe ${probe.id}: đạt ${JSON.stringify(probe.counts)}`);
    }
    log(
      plan.baselineIds.length > 0
        ? `Sẽ ghi sổ baseline (by=baseline, kèm evidence): ${plan.baselineIds.join(', ')}`
        : 'Baseline: không cần.',
    );
    log(
      plan.pendingIds.length > 0
        ? `Migration chờ (${plan.pendingIds.length}): ${plan.pendingIds.join(', ')}`
        : 'Migration chờ: không có.',
    );
    const versionToWrite = report.plan?.versionToWrite;
    log(
      versionToWrite
        ? `Phiên bản sẽ ghi: ${report.systemVersion ?? '(chưa có)'} -> ${versionToWrite}`
        : `Phiên bản: không ghi (${options.skipVersion && plan.versionToWrite ? '--skip-version' : 'đã khớp'}).`,
    );
  }

  /** Thực thi kế hoạch READY (đã giữ khóa): baseline -> migration chờ -> version. Dừng ở lỗi đầu tiên. */
  private async executeReconcile(
    plan: ReconcilePlan,
    options: ReconcileOptions,
    report: ReconcileReport,
    log: (line: string) => void,
  ): Promise<ExitCode> {
    if (this.isReconcileNoop(plan, options)) {
      log('Không có gì để làm (runner khác đã chạy xong trước đó).');
      return EXIT_CODE.OK;
    }

    for (const id of plan.baselineIds) {
      const probe = report.probes.find((candidate) => candidate.id === id);
      await this.recordApplied(id, 'baseline', probe?.counts);
      report.applied = true;
      log(`Baseline ${id}: đã ghi sổ.`);
    }

    const toRun = this.options.migrations.filter((migration) =>
      plan.pendingIds.includes(migration.id),
    );
    const failure = await this.runMigrations(toRun, options.by, log);
    if (toRun.length > 0) report.applied = true;
    if (failure !== null) {
      report.result = 'failed';
      report.reason = 'Migration lỗi (xem migration-last-error).';
      return failure;
    }

    const versionToWrite = this.effectiveVersion(plan, options);
    if (versionToWrite) {
      await this.writeVersion(versionToWrite, this.options.app.commit);
      report.applied = true;
      log(`Đã ghi phiên bản hệ thống: ${versionToWrite}.`);
    }
    await this.system.deleteOne({ _id: SYSTEM_LAST_ERROR_ID });
    log('Hoàn tất reconcile.');
    return EXIT_CODE.OK;
  }

  /** `unlock`: gỡ khóa còn sót (chỉ chạy sau khi đã kiểm tra không có runner nào đang chạy). */
  async unlock(): Promise<ExitCode> {
    const result = await this.system.deleteOne({ _id: SYSTEM_LOCK_ID });
    this.options.out(
      result.deletedCount > 0 ? 'Đã gỡ khóa.' : 'Không có khóa để gỡ.',
    );
    return EXIT_CODE.OK;
  }

  /**
   * `baseline`: ghi sổ "đã áp dụng" cho 002..006 và `version`, KHÔNG chạy lại migration cũ. Chạy một lần; từ chối nếu
   * `system` đã có `version`. Dry-run mặc định.
   */
  async baseline(
    apply: boolean,
    version: string | undefined,
    commit: string | undefined,
  ): Promise<ExitCode> {
    const { out, err } = this.options;
    if (!version || !isValidVersion(version)) {
      err('Thiếu/sai --version (dạng x.y.z, ví dụ 1.0.2).');
      return EXIT_CODE.USAGE;
    }
    if (commit !== undefined && !COMMIT_PATTERN.test(commit)) {
      err('Sai --commit (7 đến 40 ký tự hex, ví dụ e6099c0).');
      return EXIT_CODE.USAGE;
    }

    const state = await readMigrationState(this.db);
    if (state.version) {
      err(
        `Từ chối: \`system\` đã có version ${state.version.value}; baseline chỉ chạy một lần.`,
      );
      return EXIT_CODE.FAILURE;
    }

    const missing = BASELINE_MIGRATION_IDS.filter(
      (id) => !state.applied.some((doc) => doc.id === id),
    );
    if (!apply) {
      out(
        '[DRY-RUN] Không ghi gì vào DB. Sẽ ghi sổ "đã áp dụng" (by=baseline):',
      );
      for (const id of missing) out(`  ${MIGRATION_DOC_PREFIX}${id}`);
      out(`Và version = ${version}${commit ? ` (commit ${commit})` : ''}.`);
      out('Chạy thật: thêm --apply (sau khi đã kiểm chỉ-đọc và backup).');
      return EXIT_CODE.OK;
    }

    if (!(await this.isReplicaSet())) {
      err('Từ chối --apply: MongoDB không phải replica set.');
      return EXIT_CODE.FAILURE;
    }
    return this.withLock('baseline', async () => {
      // Đọc lại SAU khi giữ khóa: một baseline/up khác có thể vừa ghi `version` giữa lúc kiểm tra và lúc giành khóa
      // (không được ghi đè version của họ; "chỉ chạy một lần").
      const fresh = await readMigrationState(this.db);
      if (fresh.version) {
        err(
          `Từ chối: \`system\` vừa có version ${fresh.version.value} (runner khác đã ghi); baseline chỉ chạy một lần.`,
        );
        return EXIT_CODE.FAILURE;
      }
      for (const id of missing) await this.recordApplied(id, 'baseline');
      await this.writeVersion(version, commit ?? null);
      out(
        `Đã baseline: ${missing.length} migration ghi sổ, version = ${version}.`,
      );
      return EXIT_CODE.OK;
    });
  }

  /** Giành khóa bằng insert `_id` duy nhất (trùng = thua, không chờ); luôn nhả khóa khi xong. */
  private async withLock(
    by: MigrationActor,
    work: () => Promise<ExitCode>,
  ): Promise<ExitCode> {
    try {
      await this.system.insertOne({
        _id: SYSTEM_LOCK_ID,
        at: new Date(),
        by,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        this.options.err(
          'Từ chối: đang có runner khác chạy (khóa migration-lock). Nếu chắc chắn không có runner nào chạy, dùng `unlock`.',
        );
        return EXIT_CODE.LOCKED;
      }
      throw error;
    }
    try {
      return await work();
    } finally {
      // Nhả khóa là "cố gắng hết sức": lỗi ở đây không được biến kết quả đã xong (hoặc lỗi gốc) thành lỗi khác. Nếu nhả
      // không được thì khóa còn sót và người vận hành được báo cách gỡ.
      await this.system
        .deleteOne({ _id: SYSTEM_LOCK_ID })
        .catch((releaseError) =>
          this.options.err(
            `Cảnh báo: không nhả được khóa migration-lock (${sanitizeErrorMessage(releaseError)}). Kiểm tra rồi chạy \`unlock\`.`,
          ),
        );
    }
  }

  /**
   * Ghi sổ "đã áp dụng". `evidence` (chỉ số đếm của probe baseline, không PII) chỉ có ở bản ghi `by=baseline` do
   * `reconcile` tạo. Sổ chỉ thêm, không sửa: id đã có thì bỏ qua.
   */
  private async recordApplied(
    id: string,
    by: MigrationActor,
    evidence?: Record<string, number>,
  ): Promise<void> {
    try {
      await this.system.insertOne({
        _id: `${MIGRATION_DOC_PREFIX}${id}`,
        at: new Date(),
        by,
        ...(evidence ? { evidence } : {}),
      });
    } catch (error) {
      // Đã có trong sổ (sổ chỉ thêm, không sửa): coi như xong.
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  private async recordError(
    migrationId: string,
    error: unknown,
  ): Promise<void> {
    await this.system.replaceOne(
      { _id: SYSTEM_LAST_ERROR_ID },
      {
        _id: SYSTEM_LAST_ERROR_ID,
        migrationId,
        message: sanitizeErrorMessage(error),
        at: new Date(),
      },
      { upsert: true },
    );
  }

  private async writeVersion(
    value: string,
    commit: string | null,
  ): Promise<void> {
    await this.system.replaceOne(
      { _id: SYSTEM_VERSION_ID },
      { _id: SYSTEM_VERSION_ID, value, commit, updatedAt: new Date() },
      { upsert: true },
    );
  }

  /** Mô tả thay đổi `version` sẽ xảy ra khi apply; `null` nếu đã khớp phiên bản app. */
  private describeVersionChange(state: MigrationState): string | null {
    const target = this.options.app.version;
    if (state.version?.value === target) return null;
    return `${state.version?.value ?? '(chưa có)'} -> ${target}`;
  }

  /** Replica set <=> lệnh `hello` trả `setName`. */
  private async isReplicaSet(): Promise<boolean> {
    const hello = await this.db.admin().command({ hello: 1 });
    return typeof hello.setName === 'string';
  }

  private printPending(pending: readonly Migration[]): void {
    const { out } = this.options;
    if (pending.length === 0) {
      out('Migration chờ: không có.');
      return;
    }
    out(`Migration chờ (${pending.length}):`);
    for (const migration of pending) {
      out(
        `  ${migration.id} [${getMigrationPhase(migration)}] - ${migration.description}`,
      );
    }
  }

  private printStatus(
    state: MigrationState,
    pending: readonly Migration[],
    replicaSet: boolean,
  ): void {
    const { out, app } = this.options;
    out(`Phiên bản app: ${app.version}${app.commit ? ` (${app.commit})` : ''}`);
    out(
      state.version
        ? `Phiên bản hệ thống (DB): ${state.version.value}${state.version.commit ? ` (${state.version.commit})` : ''}, cập nhật ${formatDate(state.version.updatedAt)}`
        : 'Phiên bản hệ thống (DB): chưa có',
    );
    out(`Replica set: ${replicaSet ? 'có' : 'KHÔNG (--apply sẽ bị từ chối)'}`);
    out(`Đã áp dụng (${state.applied.length}):`);
    for (const doc of state.applied) {
      out(`  ${doc.id} (${doc.by}, ${formatDate(doc.at)})`);
    }
    this.printPending(pending);
    const postUpCount = pending.filter(
      (migration) => getMigrationPhase(migration) === 'post-up',
    ).length;
    out(`Chờ post-up: ${postUpCount}`);
    out(
      state.lock
        ? `KHÓA: đang có (${state.lock.by}, ${formatDate(state.lock.at)}). Chỉ dùng \`unlock\` khi chắc chắn không có runner nào chạy.`
        : 'Khóa: không có',
    );
    if (state.lastError) {
      out(
        `Lỗi gần nhất: ${state.lastError.migrationId} lúc ${formatDate(state.lastError.at)}: ${state.lastError.message}`,
      );
    }
    if (state.baselineRequired) {
      out(
        'CẦN BASELINE: `users` đã có dữ liệu, `system` chưa có version và sổ thiếu 002..006; `up --apply` sẽ bị từ chối. Dùng `reconcile --apply` (tự probe rồi baseline).',
      );
    }
  }
}
