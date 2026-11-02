import type { Db } from 'mongodb';
import { validateMigrationRegistry } from './migration.registry';
import type { Migration, MigrationActor } from './migration.types';
import {
  MIGRATION_DOC_PREFIX,
  SYSTEM_COLLECTION,
  SYSTEM_LAST_ERROR_ID,
  SYSTEM_LOCK_ID,
  SYSTEM_VERSION_ID,
  USERS_COLLECTION,
} from './system.constants';

export interface SystemVersionDoc {
  value: string;
  commit: string | null;
  updatedAt: Date;
}

export interface AppliedMigrationDoc {
  id: string;
  at: Date;
  by: MigrationActor;
}

export interface MigrationLockDoc {
  at: Date;
  by: MigrationActor;
}

export interface MigrationLastErrorDoc {
  migrationId: string;
  message: string;
  at: Date;
}

/** Ảnh chụp trạng thái trong `system` (chỉ ĐỌC — không ghi gì, không tạo collection/index). */
export interface MigrationState {
  version: SystemVersionDoc | null;
  applied: AppliedMigrationDoc[];
  lock: MigrationLockDoc | null;
  lastError: MigrationLastErrorDoc | null;
  /** `system` chưa có `version` mà `users` đã có dữ liệu => production cũ, cần `baseline` trước. */
  baselineRequired: boolean;
}

type SystemRow = Record<string, unknown> & { _id: string };

/** Đọc toàn bộ trạng thái runner từ collection `system`. Chỉ dùng thao tác đọc. */
export const readMigrationState = async (db: Db): Promise<MigrationState> => {
  const rows = (await db
    .collection<{ _id: string }>(SYSTEM_COLLECTION)
    .find({
      $or: [
        { _id: SYSTEM_VERSION_ID },
        { _id: SYSTEM_LOCK_ID },
        { _id: SYSTEM_LAST_ERROR_ID },
        { _id: { $regex: `^${MIGRATION_DOC_PREFIX}` } },
      ],
    })
    .toArray()) as unknown as SystemRow[];

  let version: SystemVersionDoc | null = null;
  let lock: MigrationLockDoc | null = null;
  let lastError: MigrationLastErrorDoc | null = null;
  const applied: AppliedMigrationDoc[] = [];

  for (const row of rows) {
    if (row._id === SYSTEM_VERSION_ID) {
      version = {
        value: row.value as string,
        commit: (row.commit as string | null) ?? null,
        updatedAt: row.updatedAt as Date,
      };
    } else if (row._id === SYSTEM_LOCK_ID) {
      lock = { at: row.at as Date, by: row.by as MigrationActor };
    } else if (row._id === SYSTEM_LAST_ERROR_ID) {
      lastError = {
        migrationId: row.migrationId as string,
        message: row.message as string,
        at: row.at as Date,
      };
    } else if (row._id.startsWith(MIGRATION_DOC_PREFIX)) {
      applied.push({
        id: row._id.slice(MIGRATION_DOC_PREFIX.length),
        at: row.at as Date,
        by: row.by as MigrationActor,
      });
    }
  }
  applied.sort((a, b) => a.id.localeCompare(b.id));

  const baselineRequired = version === null && (await hasUserData(db));
  return { version, applied, lock, lastError, baselineRequired };
};

/** `users` có ít nhất 1 document (dấu hiệu production đã vận hành trước khi có sổ `system`). */
export const hasUserData = async (db: Db): Promise<boolean> =>
  (await db
    .collection(USERS_COLLECTION)
    .findOne({}, { projection: { _id: 1 } })) !== null;

/** Danh sách migration chưa có trong sổ, theo thứ tự số tăng dần. */
export const selectPendingMigrations = (
  migrations: readonly Migration[],
  applied: readonly AppliedMigrationDoc[],
): Migration[] => {
  const appliedIds = new Set(applied.map((doc) => doc.id));
  return migrations
    .filter((migration) => !appliedIds.has(migration.id))
    .sort((a, b) => a.id.localeCompare(b.id));
};

/** Ném lỗi nếu registry hỏng (trùng, hở số, sai định dạng) — runner không chạy trên registry hỏng. */
export const assertValidRegistry = (migrations: readonly Migration[]): void => {
  const errors = validateMigrationRegistry(migrations);
  if (errors.length > 0) {
    throw new Error(`Registry migration không hợp lệ: ${errors.join('; ')}`);
  }
};

/**
 * Đếm migration chờ cho log cảnh báo khi backend khởi động (chỉ đọc). Không kiểm tra `baselineRequired` ở đây vì
 * chỉ cần biết còn migration chờ hay không.
 */
export const countPendingMigrations = async (
  db: Db,
  migrations: readonly Migration[],
): Promise<number> => {
  if (migrations.length === 0) return 0;
  const state = await readMigrationState(db);
  return selectPendingMigrations(migrations, state.applied).length;
};
