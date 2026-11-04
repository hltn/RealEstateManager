import type { Db, MongoClient } from 'mongodb';

/** Ngữ cảnh runner truyền cho hàm `up` của mỗi migration (không có NestJS, chỉ driver MongoDB thuần). */
export interface MigrationContext {
  client: MongoClient;
  db: Db;
  /** Ghi một dòng tiến trình ra stdout của runner. */
  log: (message: string) => void;
}

/**
 * Một migration trong registry (chỉ từ 007 trở đi). `up` BẮT BUỘC chạy lại được an toàn (idempotent): dữ liệu và sổ
 * `system` không nằm chung transaction, nên migration lỗi giữa chừng sẽ được chạy lại từ đầu ở lần `up --apply` sau.
 */
export interface Migration {
  /** Dạng `NNN_ten_khong_dau`, ví dụ `007_users_add_phone_index`. */
  id: string;
  description: string;
  up: (context: MigrationContext) => Promise<void>;
}

/** Ai kích hoạt: `deploy` (deploy.sh), `cli` (gõ tay), `baseline` (lệnh baseline). Không ghi tên người. */
export type MigrationActor = 'deploy' | 'cli' | 'baseline';
