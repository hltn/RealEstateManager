import type { Db, MongoClient } from 'mongodb';

/** Ngữ cảnh runner truyền cho hàm `up` của mỗi migration (không có NestJS, chỉ driver MongoDB thuần). */
export interface MigrationContext {
  client: MongoClient;
  db: Db;
  /** Ghi một dòng tiến trình ra stdout của runner. */
  log: (message: string) => void;
}

/**
 * Pha chạy của migration (FR-21): `pre-up` chạy TRƯỚC khi backend mới `up` (mặc định, tương thích image cũ);
 * `post-up` chỉ chạy SAU khi backend mới đã sống (ví dụ bước một chiều như bỏ unique index).
 */
export type MigrationPhase = 'pre-up' | 'post-up';

/** Giá trị cờ `--phase`: một pha cụ thể hoặc `all` (mặc định, chạy mọi migration chờ như trước đây). */
export type PhaseFilter = MigrationPhase | 'all';

export const MIGRATION_PHASES: readonly MigrationPhase[] = [
  'pre-up',
  'post-up',
];
export const PHASE_FILTERS: readonly PhaseFilter[] = [
  ...MIGRATION_PHASES,
  'all',
];

/**
 * Một migration trong registry (chỉ từ 007 trở đi). `up` BẮT BUỘC chạy lại được an toàn (idempotent): dữ liệu và sổ
 * `system` không nằm chung transaction, nên migration lỗi giữa chừng sẽ được chạy lại từ đầu ở lần `up --apply` sau.
 */
export interface Migration {
  /** Dạng `NNN_ten_khong_dau`, ví dụ `007_users_add_phone_index`. */
  id: string;
  description: string;
  /** Pha chạy; bỏ trống = `pre-up`. */
  phase?: MigrationPhase;
  up: (context: MigrationContext) => Promise<void>;
  /** Đường lùi (tùy chọn, chỉ cho migration thuần thêm index). Runner hiện CHƯA gọi; chạy tay khi cần lùi. */
  down?: (context: MigrationContext) => Promise<void>;
}

/** Ai kích hoạt: `deploy` (deploy.sh), `cli` (gõ tay), `baseline` (lệnh baseline). Không ghi tên người. */
export type MigrationActor = 'deploy' | 'cli' | 'baseline';
