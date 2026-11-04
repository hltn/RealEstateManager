/** Collection key-value `system`: mỗi document là một biến, `_id` là khóa. Runner chỉ đụng các `_id` dưới đây. */
export const SYSTEM_COLLECTION = 'system';
export const SYSTEM_VERSION_ID = 'version';
export const SYSTEM_LOCK_ID = 'migration-lock';
export const SYSTEM_LAST_ERROR_ID = 'migration-last-error';
export const MIGRATION_DOC_PREFIX = 'migration:';

/** Migration cũ 002..006 đã chạy tay trên production; `baseline` chỉ ghi sổ "đã áp dụng", KHÔNG chạy lại. */
export const BASELINE_MIGRATION_IDS: readonly string[] = [
  '002_recompute_urlhash_sha256',
  '003_drop_googledrivetokens_ttl_index',
  '004_users_add_team_id',
  '005_users_roles_teamids',
  '006_areas_34_provinces',
];

/** Collection dùng cho chốt chặn "DB đã có dữ liệu nhưng chưa baseline". */
export const USERS_COLLECTION = 'users';

/** Số thứ tự migration đầu tiên của registry (002..006 là script cũ, không đưa vào registry). */
export const FIRST_REGISTRY_MIGRATION_NUMBER = 7;

/** Lệnh gợi ý khi còn migration chờ (dùng trong log cảnh báo của backend). */
export const MIGRATION_UP_COMMAND = 'node dist/migrations/cli.js up --apply';
