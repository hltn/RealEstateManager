/**
 * Migration 002 — Recompute urlHash MD5 → SHA-256 cho RawArticle VÀ NewsArticle.
 *
 * Bối cảnh: RawArticle.urlHash trước đây sinh bằng MD5 (32 hex chars), trong khi
 * NewsArticle.urlHash phần lớn đã dùng SHA-256 (64 hex chars) ở
 * news-article.service.saveArticles. Tuy nhiên luồng Bulk Move copy thẳng
 * `article.urlHash` (MD5) sang NewsArticle → tồn tại NewsArticle.urlHash dạng MD5.
 * 2 collection lệch thuật toán hash → khó join/đối chiếu. Migration này đồng bộ
 * CẢ raw_articles VÀ news_articles sang SHA-256 (xem NEWS_MODULE_DATA_MODEL.md
 * mục 7 — changelog migration 002).
 *
 * Backward Compatible: KHÔNG — giá trị urlHash thay đổi (32→64 hex). Mọi consumer
 * chỉ đọc urlHash từ DB/API sẽ tự nhận giá trị mới; không có consumer nào hardcode
 * chiều dài MD5. Frontend chỉ truyền lại urlHash lấy từ API nên không break.
 *
 * Xử lý unique index: urlHash có unique index trên cả 2 collection. Vì hash là hàm
 * 1-1 theo url, 2 doc trùng url sẽ trùng hash SHA-256. Nếu trong DB đang có
 * duplicate url (MD5 collision cũ hoặc unique index chưa enforce), migration sẽ:
 *   - Phát hiện nhóm trùng url (dedup theo url — không theo hash cũ, vì 2 hash MD5
 *     khác nhau của cùng url sẽ cùng thu về 1 hash SHA-256 → xung unique index).
 *   - Giữ lại bài cũ nhất (theo createdAt, fallback _id), xóa (hoặc bỏ qua + log ở
 *     dry-run) các bản trùng TRƯỚC khi rehash — tránh bulkWrite vấp duplicate key.
 *
 * Thuật toán hash: dùng CHÍNH `generateUrlHash` từ src/common/utils/url-hash.util.ts
 * (KHÔNG duplicate logic SHA-256 trong migration) để tránh lệch khi util sau này
 * thêm normalize. Script chạy qua ts-node (CJS) nên import tương đối được.
 *
 * Atomic & Backup (Major M3): Apply bọc purge + bulkWrite trong ClientSession
 * transaction (yêu cầu DB cấu hình Replica Set) để 2 collection đồng thời thành công
 * hoặc cùng rollback. Trước khi --apply, snapshot trường {_id, url, urlHash} của
 * cả 2 collection ra file NDJSON tại scripts/migrations/backups/. Nếu Replica Set
 * không khả dụng (DB standalone), migration tự fallback chạy không-transaction +
 * cảnh báo (chỉ dùng cho dev).
 *
 * Rollback hint:
 *   1. Snapshot cũ nằm tại: scripts/migrations/backups/002_<ts>_raw_articles.ndjson
 *      và 002_<ts>_news_articles.ndjson (mỗi dòng 1 doc: {"_id","url","urlHash"}).
 *   2. Khôi phục: với mỗi dòng, `db.<col>.updateOne({_id}, {$set:{urlHash:<cũ>}})`.
 *      Script phụ: scripts/migrations/002_restore_from_snapshot.ts (chạy tay).
 *   3. Purge đã xóa các bản trùng url — KHÔNG thể khôi phục bằng snapshot (đã mất).
 *      Nếu cần, restore từ bản backup MongoDB đầy đủ (mongodump) trước khi chạy 002.
 *
 * Chạy:
 *   Dry-run (mặc định, không ghi):  npx ts-node scripts/migrations/002_recompute_urlhash_sha256.ts
 *   Dry-run tường minh:            npx ts-node scripts/migrations/002_recompute_urlhash_sha256.ts --dry-run
 *   Thực thi thật:                  npx ts-node scripts/migrations/002_recompute_urlhash_sha256.ts --apply
 *
 * Author: coder-backend-agent — 2026-07-28
 */

import mongoose, { type Connection } from 'mongoose';
import type { AnyBulkWriteOperation } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

// Dùng CHÍNH helper production (DRY) — không duplicate logic SHA-256 trong migration.
import { generateUrlHash } from '../../src/common/utils/url-hash.util';

interface ArticleDoc {
  _id: mongoose.Types.ObjectId;
  url: string;
  urlHash: string;
  createdAt?: Date;
}

interface CollectionConfig {
  name: string;
  label: string;
}

const COLLECTIONS: CollectionConfig[] = [
  { name: 'raw_articles', label: 'RawArticle' },
  { name: 'news_articles', label: 'NewsArticle' },
];

interface CollectionReport {
  totalDocs: number;
  wouldUpdate: number;
  alreadySha256: number;
  duplicateUrlGroups: number;
  duplicateDocsToPurge: number;
  duplicateDetails: Array<{ url: string; count: number }>;
  missingUrl: number;
  errors: string[];
}

interface MigrationReport {
  collections: Record<string, CollectionReport>;
  applied: boolean;
  snapshotPath?: string;
  transactionUsed: boolean;
  errors: string[];
}

/**
 * Đọc MONGODB_URI từ file .env ở thư mục gốc backend (không phụ thuộc @nestjs/config
 * để script chạy độc lập, nhẹ). Trả về undefined nếu không tìm thấy. Strip ký tự
 * quote (`"` / `'`) bao hai đầu sau trim để xử lý config dạng `MONGODB_URI="..."`.
 */
function loadMongoUriFromEnv(): string | undefined {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return undefined;
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('MONGODB_URI='));
  if (!match) return undefined;
  // Slice sau dấu `=`, trim, rồi gỡ quote thừa hai đầu (config thường bọc URI trong ngoặc).
  return match
    .slice('MONGODB_URI='.length)
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .trim();
}

/**
 * Logger tối giản cho CLI standalone. Skill nodejs-react-mongo-coding-guidelines
 * cấm console.log trong code NestJS (phải dùng Winston/Pino/Nest Logger). Script
 * migration này chạy ngoài DI context của Nest (ts-node trực tiếp), không có
 * container để inject Logger — nên dùng console trực tiếp + comment giải thích lý do
 * (được phép theo finding m5). Để dễ thay thế sau này, mọi output đi qua helper này.
 */
function log(msg: unknown): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}
function logError(msg: unknown): void {
  // eslint-disable-next-line no-console
  console.error(msg);
}

/**
 * Tạo report rỗng cho 1 collection.
 */
function emptyCollectionReport(): CollectionReport {
  return {
    totalDocs: 0,
    wouldUpdate: 0,
    alreadySha256: 0,
    duplicateUrlGroups: 0,
    duplicateDocsToPurge: 0,
    duplicateDetails: [],
    missingUrl: 0,
    errors: [],
  };
}

/**
 * Stream cursor theo batch (batchSize=500) qua collection, nhóm theo url để phát
 * hiện duplicate (cùng url → cùng hash SHA-256 → xung unique). Trả về:
 *   - byUrl: Map<url, ArticleDoc[]> đã sắp xếp cũ-nhất-trước (theo createdAt, fallback _id)
 *   - report: số liệu thống kê (totalDocs, alreadySha256, wouldUpdate, duplicate...)
 *
 * Dùng cursor thay vì toArray() để không tải toàn bộ mảng lớn vào memory cùng lúc
 * (m4). Projection chỉ lấy field cần thiết để tiết kiệm bandwidth.
 */
async function scanCollection(
  conn: Connection,
  cfg: CollectionConfig,
  report: CollectionReport,
): Promise<Map<string, ArticleDoc[]>> {
  const collection = conn.collection<ArticleDoc>(cfg.name);
  const byUrl = new Map<string, ArticleDoc[]>();

  // Cursor batch — không load all vào mảng. noCursorTimeout để migration dài không bị
  // server đóng cursor sau 10 phút idle.
  const cursor = collection
    .find({}, { projection: { url: 1, urlHash: 1, createdAt: 1 } })
    .batchSize(500)
    .addCursorFlag('noCursorTimeout', true);

  try {
    for await (const doc of cursor) {
      report.totalDocs += 1;
      if (!doc.url || doc.url.trim().length === 0) {
        report.missingUrl += 1;
        report.errors.push(
          `${cfg.label} doc _id=${doc._id} thiếu field url — bỏ qua.`,
        );
        continue;
      }
      const list = byUrl.get(doc.url) ?? [];
      list.push(doc);
      byUrl.set(doc.url, list);
    }
  } finally {
    await cursor.close();
  }

  // Sắp xếp mỗi nhóm cũ-nhất-trước; đánh số liệu duplicate + tính hash mới.
  for (const [url, group] of byUrl) {
    if (group.length > 1) {
      group.sort((a, b) => {
        const ta = a.createdAt?.getTime() ?? 0;
        const tb = b.createdAt?.getTime() ?? 0;
        if (ta !== tb) return ta - tb;
        return a._id.toString().localeCompare(b._id.toString());
      });
      report.duplicateUrlGroups += 1;
      report.duplicateDocsToPurge += group.length - 1;
      report.duplicateDetails.push({ url, count: group.length });
    }
    // Chỉ bài giữ lại (cũ nhất khi trùng, hoặc bản duy nhất) mới cần rehash.
    const keeper = group[0];
    const newHash = generateUrlHash(keeper.url);
    if (newHash === keeper.urlHash) {
      report.alreadySha256 += 1;
    } else {
      report.wouldUpdate += 1;
    }
  }

  return byUrl;
}

/**
 * In report dạng bảng cho 1 collection.
 */
function printCollectionReport(
  cfg: CollectionConfig,
  report: CollectionReport,
): void {
  log(`--- ${cfg.label} (${cfg.name}) ---`);
  log(`  Tổng docs          : ${report.totalDocs}`);
  log(`  Sẽ update hash    : ${report.wouldUpdate}`);
  log(`  Đã là SHA-256     : ${report.alreadySha256}`);
  log(`  Thiếu url (bỏ qua): ${report.missingUrl}`);
  log(
    `  Nhóm trùng url    : ${report.duplicateUrlGroups} (cần purge ${report.duplicateDocsToPurge} bản)`,
  );
  if (report.duplicateDetails.length > 0) {
    log('  Chi tiết trùng url:');
    for (const d of report.duplicateDetails.slice(0, 20)) {
      log(`    - ${d.url} (x${d.count})`);
    }
    if (report.duplicateDetails.length > 20) {
      log(`    ... và ${report.duplicateDetails.length - 20} nhóm nữa`);
    }
  }
  if (report.errors.length > 0) {
    log('  Lỗi/bỏ qua:');
    for (const e of report.errors.slice(0, 20)) log(`    - ${e}`);
  }
}

/**
 * Dump snapshot {_id, url, urlHash} của 1 collection ra file NDJSON để rollback.
 * NDJSON (1 doc/dòng) thay vì JSON-array để streaming không tốn memory khi collection lớn.
 */
async function snapshotCollection(
  conn: Connection,
  cfg: CollectionConfig,
  dir: string,
): Promise<string> {
  const filePath = path.join(dir, `002_${cfg.name}.ndjson`);
  const collection = conn.collection<ArticleDoc>(cfg.name);
  const cursor = collection
    .find({}, { projection: { _id: 1, url: 1, urlHash: 1 } })
    .batchSize(500)
    .addCursorFlag('noCursorTimeout', true);
  const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
  try {
    for await (const doc of cursor) {
      ws.write(
        JSON.stringify({ _id: doc._id.toString(), url: doc.url, urlHash: doc.urlHash }) +
          '\n',
      );
    }
  } finally {
    await cursor.close();
    await new Promise<void>((resolve, reject) => {
      ws.end((err?: Error) => (err ? reject(err) : resolve()));
    });
  }
  return filePath;
}

/**
 * Chuẩn bị ops (purge ids + bulkWrite updateOne) cho 1 collection dựa trên byUrl.
 */
function buildOps(byUrl: Map<string, ArticleDoc[]>): {
  purgeIds: mongoose.Types.ObjectId[];
  updateOps: AnyBulkWriteOperation<ArticleDoc>[];
} {
  const purgeIds: mongoose.Types.ObjectId[] = [];
  const updateOps: AnyBulkWriteOperation<ArticleDoc>[] = [];

  for (const group of byUrl.values()) {
    // group đã sắp xếp cũ-nhất-trước; keeper = group[0], purge phần còn lại.
    for (let i = 1; i < group.length; i++) {
      purgeIds.push(group[i]._id);
    }
    const keeper = group[0];
    const newHash = generateUrlHash(keeper.url);
    if (newHash === keeper.urlHash) continue;
    updateOps.push({
      updateOne: {
        filter: { _id: keeper._id },
        update: { $set: { urlHash: newHash } },
      },
    });
  }
  return { purgeIds, updateOps };
}

/**
 * Apply thật: purge duplicate + bulkWrite rehash cho MỌI collection trong 1
 * transaction (ClientSession) để đảm bảo atomic cross-collection (Major M3).
 * Nếu DB không phải Replica Set → fallback chạy không-transaction + cảnh báo.
 */
async function applyAll(
  conn: Connection,
  perCollection: { cfg: CollectionConfig; byUrl: Map<string, ArticleDoc[]> }[],
  report: MigrationReport,
): Promise<void> {
  // Snapshot backup trước khi ghi (Major M3).
  const backupDir = path.resolve(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupDir, `002_${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const { cfg } of perCollection) {
    const file = await snapshotCollection(conn, cfg, dir);
    log(`Snapshot backup: ${file}`);
  }
  report.snapshotPath = dir;

  const built = perCollection.map(({ cfg, byUrl }) => ({
    cfg,
    ...buildOps(byUrl),
  }));

  // Thử transaction (cần Replica Set).
  let useTx = true;
  let session: mongoose.ClientSession | undefined;
  try {
    session = await conn.startSession();
  } catch (err: any) {
    useTx = false;
    report.errors.push(
      `Không start được session (DB có thể standalone): ${err.message}. Fallback không-transaction.`,
    );
  }

  const exec = async (s?: mongoose.ClientSession): Promise<void> => {
    for (const { cfg, purgeIds, updateOps } of built) {
      const collection = conn.collection<ArticleDoc>(cfg.name);
      // Bước 1: purge các bản trùng url (giữ bản cũ nhất).
      if (purgeIds.length > 0) {
        const del = await collection.deleteMany(
          { _id: { $in: purgeIds } },
          { session: s },
        );
        log(`${cfg.label}: purge ${del.deletedCount} bản trùng url.`);
      }
      // Bước 2: bulkWrite rehash, ordered=false để 1 doc vấp duplicate key không gãy cả lô.
      if (updateOps.length > 0) {
        const result = await collection.bulkWrite(updateOps, {
          ordered: false,
          session: s,
        });
        const cr = report.collections[cfg.name];
        // m1: set wouldUpdate = modifiedCount THẬT (không phải ước lượng dry-run).
        cr.wouldUpdate = result.modifiedCount;
        // m1: inspect writeErrors (duplicate key partial failure khi ordered=false).
        const writeErrors: any[] =
          (result as any).result?.writeErrors ??
          (result as any).writeErrors ??
          [];
        if (writeErrors.length > 0) {
          const summary = writeErrors
            .slice(0, 5)
            .map((e) => e?.errmsg || e?.message || JSON.stringify(e))
            .join(' | ');
          cr.errors.push(
            `${cfg.label} bulkWrite có ${writeErrors.length} writeError(s): ${summary}`,
          );
          report.errors.push(
            `${cfg.label} bulkWrite có ${writeErrors.length} writeError(s) (xem chi tiết trong report collection).`,
          );
        }
        log(
          `${cfg.label}: update ${result.modifiedCount}/${updateOps.length} doc sang SHA-256.`,
        );
      } else {
        log(`${cfg.label}: không có doc cần update (tất cả đã là SHA-256).`);
      }
    }
  };

  if (useTx && session) {
    try {
      await session.withTransaction(async () => {
        await exec(session);
      });
      report.transactionUsed = true;
    } catch (err: any) {
      // Nếu lỗi do DB không phải replica set → fallback chạy thường.
      if (/replica set|transaction/i.test(err.message)) {
        report.errors.push(
          `Transaction thất bại (DB standalone?): ${err.message}. Fallback không-transaction.`,
        );
        report.transactionUsed = false;
        await exec();
      } else {
        throw err;
      }
    } finally {
      await session.endSession().catch(() => void 0);
    }
  } else {
    report.transactionUsed = false;
    await exec();
  }
}

/**
 * Thực thi migration. dryRun=true: chỉ scan + báo cáo, KHÔNG ghi.
 * dryRun=false (--apply): snapshot backup + transaction purge + bulkWrite rehash.
 */
async function runMigration(dryRun: boolean): Promise<MigrationReport> {
  const uri = loadMongoUriFromEnv() ?? process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Không tìm thấy MONGODB_URI (.env hoặc env var). Đặt MONGODB_URI rồi chạy lại.',
    );
  }

  const conn: Connection = await mongoose.createConnection(uri).asPromise();
  try {
    const report: MigrationReport = {
      collections: {},
      applied: !dryRun,
      transactionUsed: false,
      errors: [],
    };
    const perCollection: { cfg: CollectionConfig; byUrl: Map<string, ArticleDoc[]> }[] =
      [];

    for (const cfg of COLLECTIONS) {
      const cr = emptyCollectionReport();
      report.collections[cfg.name] = cr;
      const byUrl = await scanCollection(conn, cfg, cr);
      perCollection.push({ cfg, byUrl });
    }

    log('===== Migration 002 — Recompute urlHash MD5 → SHA-256 =====');
    log(`Mode: ${dryRun ? 'DRY-RUN (không ghi)' : 'APPLY (ghi thật)'}`);
    for (const cfg of COLLECTIONS) {
      printCollectionReport(cfg, report.collections[cfg.name]);
    }

    if (dryRun) {
      log('\n-> Dry-run: KHÔ ghi dữ liệu. Chạy với --apply để thực thi thật.');
      return report;
    }

    await applyAll(conn, perCollection, report);
    log(
      `\nApply xong. Transaction: ${report.transactionUsed ? 'CÓ (replica set)' : 'KHÔNG (fallback standalone)'}.`,
    );
    if (report.snapshotPath) {
      log(`Snapshot rollback tại: ${report.snapshotPath}`);
    }
    return report;
  } finally {
    await conn.close();
  }
}

// ===== Entry point — guard để import file vào test không trigger main =====
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply; // mặc định dry-run
  try {
    await runMigration(dryRun);
  } catch (err) {
    logError(`Migration thất bại: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
