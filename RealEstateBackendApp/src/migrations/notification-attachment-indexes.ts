import type { Db, Document } from 'mongodb';

/** Mã lỗi Mongo: collection chưa tồn tại / index không tồn tại. */
const NAMESPACE_NOT_FOUND = 26;
const INDEX_NOT_FOUND = 27;

/** Một index do migration 009 quản lý (Architecture 5.1.10). */
export interface ManagedIndex {
  collection: string;
  name: string;
  keys: Record<string, 1 | -1>;
  partialFilterExpression: Document;
}

/**
 * Hai index của migration 009. Tên khai báo TƯỜNG MINH (trùng tên mặc định của driver) để `down` chỉ gỡ đúng hai index
 * này, không đụng index khác trên cùng collection.
 * - `notifications`: job quét push chỉ cần các dòng còn `PENDING` (FR-03).
 * - `crm_attachments`: job bù thumbnail chỉ cần ảnh chưa `READY` (FR-26). MongoDB KHÔNG cho `$ne` trong
 *   `partialFilterExpression`, nên dùng `$in ['NONE','FAILED']` (Architecture 5.1.10); ảnh cũ thiếu `thumbStatus`
 *   không nằm trong index, job bù xử lý chúng bằng truy vấn riêng.
 */
export const NOTIFICATION_ATTACHMENT_INDEXES: readonly ManagedIndex[] = [
  {
    collection: 'notifications',
    name: 'pushStatus_1_createdAt_1',
    keys: { pushStatus: 1, createdAt: 1 },
    partialFilterExpression: { pushStatus: 'PENDING' },
  },
  {
    collection: 'crm_attachments',
    name: 'thumbStatus_1_createdAt_1',
    keys: { thumbStatus: 1, createdAt: 1 },
    partialFilterExpression: { thumbStatus: { $in: ['NONE', 'FAILED'] } },
  },
];

export interface NotificationAttachmentIndexesResult {
  /** Tên index (dạng `collection.name`) đã tạo (apply) hoặc SẼ tạo (dry-run) vì chưa tồn tại. */
  created: string[];
  /** Index đã tồn tại sẵn (chạy lại): không làm gì. */
  existing: string[];
}

const hasErrorCode = (error: unknown, code: number): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === code;

async function indexExists(db: Db, spec: ManagedIndex): Promise<boolean> {
  try {
    return await db.collection(spec.collection).indexExists(spec.name);
  } catch (error) {
    // Collection chưa có (DB mới/chưa có dữ liệu): coi như chưa có index.
    if (hasErrorCode(error, NAMESPACE_NOT_FOUND)) return false;
    throw error;
  }
}

/**
 * `up`: tạo index còn thiếu. CHỈ thêm index, không đọc/ghi dữ liệu. Idempotent: index đã có cùng tên và định nghĩa thì
 * `createIndex` bỏ qua; ở đây còn kiểm trước để báo đúng "đã có". `apply=false` (dry-run) chỉ liệt kê, không ghi.
 */
export async function createNotificationAttachmentIndexes(
  db: Db,
  apply: boolean,
  log?: (message: string) => void,
): Promise<NotificationAttachmentIndexesResult> {
  const result: NotificationAttachmentIndexesResult = {
    created: [],
    existing: [],
  };
  for (const spec of NOTIFICATION_ATTACHMENT_INDEXES) {
    const label = `${spec.collection}.${spec.name}`;
    if (await indexExists(db, spec)) {
      result.existing.push(label);
      continue;
    }
    if (apply) {
      await db.collection(spec.collection).createIndex(spec.keys, {
        name: spec.name,
        partialFilterExpression: spec.partialFilterExpression,
      });
    }
    result.created.push(label);
  }
  log?.(
    `${apply ? 'Đã tạo' : 'Dry-run: sẽ tạo'} ${result.created.length} index` +
      ` [${result.created.join(', ')}]; đã có sẵn ${result.existing.length} [${result.existing.join(', ')}]`,
  );
  return result;
}

/**
 * `down`: gỡ ĐÚNG hai index của 009 theo tên. Index không tồn tại (hoặc collection chưa có) thì bỏ qua, nên chạy lại
 * không lỗi. An toàn vì image cũ không dùng hai index này; không đụng dữ liệu hay index khác.
 */
export async function dropNotificationAttachmentIndexes(
  db: Db,
  log?: (message: string) => void,
): Promise<string[]> {
  const dropped: string[] = [];
  for (const spec of NOTIFICATION_ATTACHMENT_INDEXES) {
    try {
      await db.collection(spec.collection).dropIndex(spec.name);
      dropped.push(`${spec.collection}.${spec.name}`);
    } catch (error) {
      if (
        !hasErrorCode(error, NAMESPACE_NOT_FOUND) &&
        !hasErrorCode(error, INDEX_NOT_FOUND)
      ) {
        throw error;
      }
    }
  }
  log?.(`Đã gỡ ${dropped.length} index [${dropped.join(', ')}]`);
  return dropped;
}
