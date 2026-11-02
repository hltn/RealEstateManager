import { MongoClient, MongoServerError } from 'mongodb';
import type { Db } from 'mongodb';
import { sanitizeErrorMessage } from './migration-error.util';
import {
  assertValidRegistry,
  readMigrationState,
  selectPendingMigrations,
} from './migration-state';
import type { MigrationState } from './migration-state';
import type { Migration, MigrationActor } from './migration.types';
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

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
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
          pending: pending.map(({ id, description }) => ({ id, description })),
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
  async up(apply: boolean, by: MigrationActor): Promise<ExitCode> {
    assertValidRegistry(this.options.migrations);
    const { out, err } = this.options;
    const state = await readMigrationState(this.db);

    // Chốt chặn: tuyệt đối không tự chạy 002..006 / bỏ qua sổ chỉ vì `system` trống trên DB đã có dữ liệu.
    if (state.baselineRequired) {
      err(
        'Từ chối: `system` chưa có `version` nhưng `users` đã có dữ liệu. Cần chạy `baseline` một lần trước ' +
          '(node dist/migrations/cli.js baseline --apply --version <x.y.z> --commit <sha>).',
      );
      return EXIT_CODE.BASELINE_REQUIRED;
    }

    const pending = selectPendingMigrations(
      this.options.migrations,
      state.applied,
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
      const toRun = selectPendingMigrations(
        this.options.migrations,
        fresh.applied,
      );
      for (const migration of toRun) {
        out(`Chạy ${migration.id}: ${migration.description}`);
        try {
          await migration.up({
            client: this.options.client,
            db: this.db,
            log: (message) => out(`  ${message}`),
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
        out(`Xong ${migration.id}.`);
      }
      await this.writeVersion(
        this.options.app.version,
        this.options.app.commit,
      );
      await this.system.deleteOne({ _id: SYSTEM_LAST_ERROR_ID });
      out(`Hoàn tất. Phiên bản hệ thống: ${this.options.app.version}.`);
      return EXIT_CODE.OK;
    });
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
    if (!version || !VERSION_PATTERN.test(version)) {
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

  private async recordApplied(id: string, by: MigrationActor): Promise<void> {
    try {
      await this.system.insertOne({
        _id: `${MIGRATION_DOC_PREFIX}${id}`,
        at: new Date(),
        by,
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
      out(`  ${migration.id} - ${migration.description}`);
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
        'CẦN BASELINE: `users` đã có dữ liệu nhưng `system` chưa có version; `up --apply` sẽ bị từ chối.',
      );
    }
  }
}
